import { EventEmitter } from "node:events";
import { ConnectorError } from "../connector.types";
import { SshConnector } from "./ssh-connector";

/**
 * ssh2's Client is mocked here rather than exercised against a real
 * sshd — this verifies the connector's own logic (credential validation,
 * timeout handling, stdout/stderr/exit-code wiring, host-key
 * trust-on-first-use) without requiring live infrastructure. Running
 * this connector against a real Linux host (e.g. the Beelink) is a
 * separate, manual verification step documented in README.md.
 */
class FakeStream extends EventEmitter {
  stderr = new EventEmitter();
}

/** The fingerprint every FakeClient "presents" during its simulated
 * handshake — deterministic so tests can assert on the exact base64
 * string `verifyHostKey` will see, matching what a real ssh2 handshake
 * would hand the connector's `hostVerifier`. */
const FAKE_HOST_KEY_HASH = Buffer.from("fake-key-hash-for-tests");
const FAKE_HOST_KEY_FINGERPRINT = FAKE_HOST_KEY_HASH.toString("base64");

class FakeClient extends EventEmitter {
  lastExecCommand: string | undefined;
  nextExitCode = 0;
  nextStdout = "";
  nextStderr = "";
  connect(config: { hostVerifier?: (keyHash: Buffer) => boolean }) {
    const accepted = config.hostVerifier ? config.hostVerifier(FAKE_HOST_KEY_HASH) : true;
    if (!accepted) {
      queueMicrotask(() => this.emit("error", new Error("host key verification failed")));
      return this;
    }
    queueMicrotask(() => this.emit("ready"));
    return this;
  }
  exec(command: string, callback: (err: Error | undefined, stream: FakeStream) => void) {
    this.lastExecCommand = command;
    const stream = new FakeStream();
    callback(undefined, stream);
    queueMicrotask(() => {
      stream.emit("data", Buffer.from(this.nextStdout));
      stream.stderr.emit("data", Buffer.from(this.nextStderr));
      stream.emit("close", this.nextExitCode);
    });
  }
  end() {}
}

let fakeClient: FakeClient;

jest.mock("ssh2", () => ({
  Client: jest.fn().mockImplementation(() => fakeClient),
}));

describe("SshConnector", () => {
  const connector = new SshConnector();

  beforeEach(() => {
    fakeClient = new FakeClient();
  });

  const target = {
    deviceId: "dev-1",
    host: "10.0.0.5",
    credential: {
      protocol: "SSH" as const,
      payload: { username: "gavin", password: "secret" },
    },
  };

  it("rejects when no credential is attached", async () => {
    await expect(
      connector.executeCommand({ deviceId: "dev-1", host: "10.0.0.5" }, "uptime", { timeoutMs: 1000 }),
    ).rejects.toThrow(ConnectorError);
  });

  it("executes a command and returns stdout/stderr/exit code", async () => {
    fakeClient.nextStdout = "hello\n";
    fakeClient.nextExitCode = 0;

    const result = await connector.executeCommand(target, "echo hello", { timeoutMs: 2000 });

    expect(result).toEqual({ exitCode: 0, stdout: "hello\n", stderr: "", timedOut: false });
    expect(fakeClient.lastExecCommand).toBe("echo hello");
  });

  it("reports OFFLINE health when the probe exits non-zero", async () => {
    fakeClient.nextExitCode = 1;

    const health = await connector.getHealth(target);

    expect(health.onlineState).toBe("OFFLINE");
  });

  it("reports ONLINE health when the probe succeeds", async () => {
    fakeClient.nextExitCode = 0;

    const health = await connector.getHealth(target);

    expect(health.onlineState).toBe("ONLINE");
  });

  it("parses the metrics probe output into typed readings", async () => {
    // load1=0.25 memUsed=4000000000 memTotal=8000000000 uptime=12345.6 diskUsed=10000000000 diskTotal=100000000000
    fakeClient.nextStdout = "0.25 4000000000 8000000000 12345.6 10000000000 100000000000";
    fakeClient.nextExitCode = 0;

    const readings = await connector.getMetrics(target);

    const cpu = readings.find((r) => r.kind === "CPU_UTILIZATION");
    const mem = readings.find((r) => r.kind === "MEMORY_UTILIZATION");
    const uptime = readings.find((r) => r.kind === "UPTIME_SECONDS");
    const disk = readings.find((r) => r.kind === "DISK_UTILIZATION");

    expect(cpu?.value).toBe(0.25);
    expect(mem?.value).toBe(50);
    expect(uptime?.value).toBe(12345.6);
    expect(disk?.value).toBe(10);
  });

  it("cancels a running command when its AbortSignal fires", async () => {
    fakeClient.exec = (_command: string, callback: (err: Error | undefined, stream: FakeStream) => void) => {
      callback(undefined, new FakeStream()); // never emits "close" on its own
    };
    const controller = new AbortController();

    const resultPromise = connector.executeCommand(target, "sleep 999", { timeoutMs: 5000, signal: controller.signal });
    controller.abort();
    const result = await resultPromise;

    expect(result.cancelled).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it("times out a command that never closes its stream", async () => {
    fakeClient.exec = (_command: string, callback: (err: Error | undefined, stream: FakeStream) => void) => {
      callback(undefined, new FakeStream()); // never emits "close"
    };

    const result = await connector.executeCommand(target, "sleep 999", { timeoutMs: 20 });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  describe("host key pinning", () => {
    it("surfaces a newly-pinned fingerprint only the first time a host is seen", async () => {
      const freshConnector = new SshConnector();
      const freshTarget = { ...target, host: "10.0.0.99" };

      const first = await freshConnector.getHealth(freshTarget);
      expect(first.newlyPinnedHostKeyFingerprint).toBeDefined();

      const second = await freshConnector.getHealth(freshTarget);
      expect(second.newlyPinnedHostKeyFingerprint).toBeUndefined();
    });

    it("never surfaces a fingerprint when the credential already carries a matching pin", async () => {
      const pinnedTarget = {
        ...target,
        host: "10.0.0.50",
        credential: { ...target.credential, payload: { ...target.credential.payload, hostKeyFingerprint: FAKE_HOST_KEY_FINGERPRINT } },
      };
      const freshConnector = new SshConnector();

      const health = await freshConnector.getHealth(pinnedTarget);
      expect(health.newlyPinnedHostKeyFingerprint).toBeUndefined();
      expect(health.onlineState).toBe("ONLINE");
    });

    it("refuses to connect — never silently accepting a changed host key — when the pinned fingerprint doesn't match", async () => {
      const mismatchedTarget = {
        ...target,
        host: "10.0.0.51",
        credential: { ...target.credential, payload: { ...target.credential.payload, hostKeyFingerprint: "a-completely-different-fingerprint" } },
      };
      const freshConnector = new SshConnector();

      const health = await freshConnector.getHealth(mismatchedTarget);

      expect(health.onlineState).toBe("OFFLINE");
      expect(health.detail).toMatch(/host key/i);
      expect(fakeClient.lastExecCommand).toBeUndefined();
    });
  });

  describe("runDiagnostic", () => {
    it("runs os_info and returns capped, uninterpreted output", async () => {
      fakeClient.nextStdout = "NAME=Ubuntu\nVERSION=22.04";
      fakeClient.nextExitCode = 0;

      const result = await connector.runDiagnostic!(target, "os_info");

      expect(result.name).toBe("os_info");
      expect(result.output).toContain("Ubuntu");
      expect(fakeClient.lastExecCommand).toContain("/etc/os-release");
    });

    it("rejects a service_status call with a shell-metacharacter service name before it ever reaches a command", async () => {
      await expect(connector.runDiagnostic!(target, "service_status", { service: "nginx; rm -rf /" })).rejects.toThrow(/plain identifier/);
    });

    it("accepts a valid service name and interpolates only that", async () => {
      fakeClient.nextStdout = "active";
      fakeClient.nextExitCode = 0;

      await connector.runDiagnostic!(target, "service_status", { service: "nginx" });

      expect(fakeClient.lastExecCommand).toContain("systemctl status nginx");
    });

    it("clamps system_logs line count into [1, 1000]", async () => {
      fakeClient.nextExitCode = 0;

      await connector.runDiagnostic!(target, "system_logs", { lines: 999999 });

      expect(fakeClient.lastExecCommand).toContain("-n 1000");
    });

    it("parses security_posture into structured findings, not a raw dump", async () => {
      fakeClient.nextStdout = [
        "---SSHD---",
        "PermitRootLogin yes",
        "PasswordAuthentication yes",
        "---SUDO---",
        "sudo:x:27:gavin",
        "---FAILEDLOGINS---",
        "42",
        "---UPDATES---",
        "3",
        "---IDENTITY---",
        "uid=1000(gavin) gid=1000(gavin)",
        "---WORLDWRITABLE---",
        "/etc/foo.conf",
      ].join("\n");
      fakeClient.nextExitCode = 0;

      const result = await connector.runDiagnostic!(target, "security_posture");

      expect(result.findings).toBeDefined();
      const bySeverityHigh = result.findings!.filter((f) => f.severity === "high");
      expect(bySeverityHigh.some((f) => f.check === "sshd:PermitRootLogin")).toBe(true);
      expect(bySeverityHigh.some((f) => f.check === "filesystem:world-writable")).toBe(true);
      expect(result.findings!.find((f) => f.check === "auth:failed-logins")?.detail).toContain("42");
      expect(result.findings!.find((f) => f.check === "packages:upgradable")?.detail).toContain("3 package");
    });
  });

  describe("performAction", () => {
    it("rejects an unsupported action without touching the SSH connection", async () => {
      const result = await connector.performAction!(target, "delete_everything");

      expect(result.success).toBe(false);
      expect(fakeClient.lastExecCommand).toBeUndefined();
    });

    it("rejects an unsafe service name for service_restart", async () => {
      await expect(connector.performAction!(target, "service_restart", { service: "$(reboot)" })).rejects.toThrow(/plain identifier/);
    });

    it("runs service_restart with a validated service name and reports success from the exit code", async () => {
      fakeClient.nextExitCode = 0;
      fakeClient.nextStdout = "active";

      const result = await connector.performAction!(target, "service_restart", { service: "nginx" });

      expect(result.success).toBe(true);
      expect(fakeClient.lastExecCommand).toContain("systemctl restart nginx");
    });

    it("reports failure (not a thrown error) when the remote command exits non-zero", async () => {
      fakeClient.nextExitCode = 1;
      fakeClient.nextStderr = "Unit nope.service not found.";

      const result = await connector.performAction!(target, "service_restart", { service: "nope" });

      expect(result.success).toBe(false);
      expect(result.detail).toContain("not found");
    });
  });
});
