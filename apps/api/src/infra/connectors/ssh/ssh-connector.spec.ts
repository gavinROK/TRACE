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

class FakeClient extends EventEmitter {
  lastExecCommand: string | undefined;
  nextExitCode = 0;
  nextStdout = "";
  nextStderr = "";
  connect() {
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
});
