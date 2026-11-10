import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InfraManagementProtocol, InfraMetricKind } from "@prisma/client";
import { Client, type ConnectConfig } from "ssh2";
import type {
  ActionResult,
  CommandResult,
  ConnectorCapability,
  ConnectorTarget,
  DiagnosticName,
  DiagnosticResult,
  HealthResult,
  InfraConnector,
  MetricReading,
  SecurityFinding,
} from "../connector.types";
import { ConnectorError } from "../connector.types";

/** Every diagnostic/action parameter that becomes part of a shell
 * command (a service name, a package name, a systemd unit) must match
 * this before it's ever interpolated — rejecting anything else is what
 * makes string interpolation here safe instead of a command-injection
 * vector. Deliberately conservative: real service/package names never
 * need spaces, quotes, `;`, `$()`, or other shell metacharacters. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,127}$/;

function requireSafeIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    throw new BadRequestException(
      `"${field}" must be a plain identifier (letters, digits, "_.@:-" only, max 128 chars) — got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Caps the diagnostic/action output actually stored and returned to
 * the caller (and, from there, to the MCP client) — a runaway package
 * list or log dump must never balloon an audit row or a model's
 * context unbounded. */
const MAX_OUTPUT_BYTES = 200_000;

function capOutput(text: string): { output: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return { output: text, truncated: false };
  return { output: `${text.slice(0, MAX_OUTPUT_BYTES)}\n...[truncated]`, truncated: true };
}

/** Service/package administrative actions SshConnector.performAction
 * supports — mirrors the shape of Proxmox's start/stop/shutdown/reboot
 * so `trace_perform_action` needs no protocol-specific branching.
 * `service_stop`/`service_restart` are registered as DESTRUCTIVE in
 * `ActionsService.DESTRUCTIVE_ACTIONS`; the rest are ADMINISTRATIVE. */
export const SSH_ACTIONS = [
  "service_start",
  "service_stop",
  "service_restart",
  "service_enable",
  "service_disable",
  "package_install",
  "reboot",
] as const;
export type SshAction = (typeof SSH_ACTIONS)[number];

interface SshCredentialPayload {
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  port?: number;
  /** Known host public key fingerprint (base64 SHA256), required once a
   * device has been connected to successfully once — see
   * `recordHostKey`. Verifying against a pinned fingerprint instead of
   * disabling host-key checking is what stops a MITM on the first
   * connection from going unnoticed on every one after it. */
  hostKeyFingerprint?: string;
}

/**
 * A single remote probe that prints five whitespace-delimited numbers,
 * used by getMetrics(). Every value comes from a real /proc read on the
 * target at the moment the command actually ran — nothing here is
 * interpolated or estimated.
 */
const METRICS_PROBE =
  'echo "$(cat /proc/loadavg | cut -d" " -f1) $(free -b | awk "/Mem:/{print \\$3, \\$2}") $(cat /proc/uptime | cut -d" " -f1) $(df -B1 / | tail -1 | awk "{print \\$3, \\$2}")"';

@Injectable()
export class SshConnector implements InfraConnector {
  readonly protocol = InfraManagementProtocol.SSH;
  private readonly logger = new Logger(SshConnector.name);
  private readonly knownHostKeys = new Map<string, string>();

  getCapabilities(): ConnectorCapability[] {
    return ["getHealth", "getMetrics", "executeCommand", "runDiagnostic", "performAction"];
  }

  /** Records the host key fingerprint seen on first successful connect,
   * so later connections can detect a changed key instead of silently
   * trusting whatever key the host presents (ssh2's default). The
   * in-memory map is the first line of defense within one process's
   * lifetime; `newlyPinnedFingerprint` (returned here) is how a caller
   * that holds the credential record — `DevicePollingService` — persists
   * the pin so it survives a restart too (see credentials.service.ts's
   * `recordHostKeyFingerprint`). */
  private verifyHostKey(host: string, fingerprint: string, pinned?: string): { ok: boolean; newlyPinnedFingerprint?: string } {
    const effectivePinned = pinned ?? this.knownHostKeys.get(host);
    if (!effectivePinned) {
      this.knownHostKeys.set(host, fingerprint);
      this.logger.warn(
        `Trust-on-first-use: recorded host key for ${host}. Pin this fingerprint in the device's credential record to detect future changes.`,
      );
      return { ok: true, newlyPinnedFingerprint: fingerprint };
    }
    if (effectivePinned !== fingerprint) {
      this.logger.error(`Host key MISMATCH for ${host} — refusing to connect. Expected ${effectivePinned}, got ${fingerprint}.`);
    }
    return { ok: effectivePinned === fingerprint };
  }

  async getHealth(target: ConnectorTarget): Promise<HealthResult> {
    try {
      const result = await this.exec(target, "true", 5_000);
      return {
        onlineState: result.exitCode === 0 ? "ONLINE" : "OFFLINE",
        checkedAt: new Date(),
        newlyPinnedHostKeyFingerprint: result.newlyPinnedHostKeyFingerprint,
      };
    } catch (error) {
      return {
        onlineState: "OFFLINE",
        checkedAt: new Date(),
        detail: error instanceof Error ? error.message : "unreachable",
      };
    }
  }

  async getMetrics(target: ConnectorTarget): Promise<MetricReading[]> {
    const result = await this.exec(target, METRICS_PROBE, 10_000);
    if (result.exitCode !== 0) {
      throw new ConnectorError(`metrics probe exited ${result.exitCode}: ${result.stderr}`);
    }
    const parts = result.stdout.trim().split(/\s+/).map(Number);
    const [load1, memUsedBytes, memTotalBytes, uptimeSeconds, diskUsedBytes, diskTotalBytes] = parts;
    const collectedAt = new Date();
    const readings: MetricReading[] = [];

    if (Number.isFinite(load1)) {
      readings.push({ kind: InfraMetricKind.CPU_UTILIZATION, label: "load1", value: load1, unit: "load", collectedAt });
    }
    if (Number.isFinite(memUsedBytes) && Number.isFinite(memTotalBytes) && memTotalBytes > 0) {
      readings.push({
        kind: InfraMetricKind.MEMORY_UTILIZATION,
        value: (memUsedBytes / memTotalBytes) * 100,
        unit: "percent",
        collectedAt,
      });
      readings.push({ kind: InfraMetricKind.MEMORY_USED_BYTES, value: memUsedBytes, unit: "bytes", collectedAt });
      readings.push({ kind: InfraMetricKind.MEMORY_TOTAL_BYTES, value: memTotalBytes, unit: "bytes", collectedAt });
    }
    if (Number.isFinite(uptimeSeconds)) {
      readings.push({ kind: InfraMetricKind.UPTIME_SECONDS, value: uptimeSeconds, unit: "seconds", collectedAt });
    }
    if (Number.isFinite(diskUsedBytes) && Number.isFinite(diskTotalBytes) && diskTotalBytes > 0) {
      readings.push({
        kind: InfraMetricKind.DISK_UTILIZATION,
        label: "/",
        value: (diskUsedBytes / diskTotalBytes) * 100,
        unit: "percent",
        collectedAt,
      });
      readings.push({ kind: InfraMetricKind.DISK_USED_BYTES, label: "/", value: diskUsedBytes, unit: "bytes", collectedAt });
      readings.push({ kind: InfraMetricKind.DISK_TOTAL_BYTES, label: "/", value: diskTotalBytes, unit: "bytes", collectedAt });
    }
    return readings;
  }

  async executeCommand(
    target: ConnectorTarget,
    command: string,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<CommandResult> {
    // Strip the internal host-key-pin bookkeeping — CommandResult's
    // contract (and from there, InfraCommandRun / trace_execute_command's
    // JSON output) has no business carrying it; only getHealth surfaces
    // it, for DevicePollingService to persist.
    const { exitCode, stdout, stderr, timedOut, cancelled } = await this.exec(target, command, options.timeoutMs, options.signal);
    return { exitCode, stdout, stderr, timedOut, ...(cancelled !== undefined ? { cancelled } : {}) };
  }

  async runDiagnostic(target: ConnectorTarget, name: DiagnosticName, params?: Record<string, unknown>): Promise<DiagnosticResult> {
    if (name === "security_posture") {
      return this.runSecurityPosture(target);
    }
    const command = this.buildDiagnosticCommand(name, params);
    const result = await this.exec(target, command, 20_000);
    const { output, truncated } = capOutput(result.stdout || result.stderr);
    return { name, collectedAt: new Date(), output, truncated };
  }

  private buildDiagnosticCommand(name: DiagnosticName, params?: Record<string, unknown>): string {
    switch (name) {
      case "os_info":
        return "cat /etc/os-release 2>/dev/null; echo ---; uname -srvmo 2>&1";
      case "cpu_memory_disk":
        return "uptime; echo ---; free -h 2>&1; echo ---; df -h 2>&1";
      case "network_interfaces":
        return (
          "(ip -brief addr show 2>/dev/null || ifconfig -a 2>&1); echo ---; " +
          "(ip route 2>/dev/null || route -n 2>&1); echo ---; " +
          "(ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null || echo 'ss/netstat unavailable')"
        );
      case "service_status": {
        const service = requireSafeIdentifier(params?.service, "service");
        return `(systemctl status ${service} --no-pager -l 2>&1 || service ${service} status 2>&1)`;
      }
      case "system_logs": {
        const lines = clampLines(params?.lines);
        const unit = params?.unit !== undefined ? requireSafeIdentifier(params.unit, "unit") : undefined;
        const unitFlag = unit ? `-u ${unit} ` : "";
        return (
          `(journalctl ${unitFlag}-n ${lines} --no-pager 2>&1) || ` +
          `(tail -n ${lines} /var/log/syslog 2>/dev/null) || (tail -n ${lines} /var/log/messages 2>/dev/null) || echo 'no accessible log source'`
        );
      }
      case "process_list":
        return "ps aux --sort=-%cpu 2>/dev/null | head -50";
      case "package_inventory":
        return (
          "(command -v dpkg >/dev/null 2>&1 && dpkg -l 2>/dev/null | tail -n +6 | head -500) || " +
          "(command -v rpm >/dev/null 2>&1 && rpm -qa 2>/dev/null | head -500) || " +
          "(command -v apk >/dev/null 2>&1 && apk info -v 2>/dev/null | head -500) || " +
          "echo 'no supported package manager found (dpkg/rpm/apk)'"
        );
      case "firewall_rules":
        return (
          "(command -v ufw >/dev/null 2>&1 && echo '--- ufw ---' && ufw status verbose 2>&1); " +
          "(command -v nft >/dev/null 2>&1 && echo '--- nft ---' && nft list ruleset 2>&1); " +
          "(command -v iptables >/dev/null 2>&1 && echo '--- iptables ---' && iptables -L -n -v 2>&1)"
        );
      case "filesystem_info":
        return "df -h 2>&1; echo ---; (lsblk 2>/dev/null || fdisk -l 2>/dev/null); echo ---; (mount | column -t 2>/dev/null || mount)";
      case "security_posture":
        throw new ConnectorError("security_posture is handled separately — buildDiagnosticCommand should never be called for it");
    }
  }

  /** Runs several safe read-only probes in one SSH round-trip and turns
   * them into scannable findings — the composite most directly useful
   * for "audit my infrastructure for security weaknesses," rather than
   * a raw text dump the caller has to interpret itself. */
  private async runSecurityPosture(target: ConnectorTarget): Promise<DiagnosticResult> {
    const probe = [
      "echo ---SSHD---",
      "grep -E '^[[:space:]]*(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Port)[[:space:]]' /etc/ssh/sshd_config 2>/dev/null",
      "echo ---SUDO---",
      "getent group sudo wheel 2>/dev/null",
      "echo ---FAILEDLOGINS---",
      "(grep -c 'Failed password' /var/log/auth.log 2>/dev/null) || (journalctl -u ssh --since -7days 2>/dev/null | grep -c 'Failed password') || echo 0",
      "echo ---UPDATES---",
      "(command -v apt-get >/dev/null 2>&1 && apt list --upgradable 2>/dev/null | tail -n +2 | wc -l) || echo 0",
      "echo ---IDENTITY---",
      "id",
      "echo ---WORLDWRITABLE---",
      "find /etc -maxdepth 2 -perm -0002 -type f 2>/dev/null | head -20",
    ].join("; ");

    const result = await this.exec(target, probe, 20_000);
    const sections = parseSections(result.stdout);
    const findings: SecurityFinding[] = [];

    const sshd = sections.SSHD ?? "";
    if (/PermitRootLogin\s+yes/i.test(sshd)) {
      findings.push({ severity: "high", check: "sshd:PermitRootLogin", detail: "Root login over SSH is enabled (PermitRootLogin yes)." });
    }
    if (/PasswordAuthentication\s+yes/i.test(sshd) || !/PasswordAuthentication/i.test(sshd)) {
      findings.push({
        severity: "medium",
        check: "sshd:PasswordAuthentication",
        detail: "Password authentication appears enabled (or unset, which defaults to enabled) — prefer key-only auth.",
      });
    }

    const failedLogins = Number.parseInt((sections.FAILEDLOGINS ?? "0").trim(), 10) || 0;
    if (failedLogins > 20) {
      findings.push({ severity: "medium", check: "auth:failed-logins", detail: `${failedLogins} failed SSH login attempts found in the log.` });
    } else {
      findings.push({ severity: "info", check: "auth:failed-logins", detail: `${failedLogins} failed SSH login attempts found in the log.` });
    }

    const upgradable = Number.parseInt((sections.UPDATES ?? "0").trim(), 10) || 0;
    if (upgradable > 0) {
      findings.push({ severity: "medium", check: "packages:upgradable", detail: `${upgradable} package update(s) available.` });
    } else {
      findings.push({ severity: "info", check: "packages:upgradable", detail: "No pending package updates detected (or apt not in use)." });
    }

    const worldWritable = (sections.WORLDWRITABLE ?? "").trim().split("\n").filter(Boolean);
    if (worldWritable.length > 0) {
      findings.push({
        severity: "high",
        check: "filesystem:world-writable",
        detail: `${worldWritable.length} world-writable file(s) under /etc, e.g. ${worldWritable[0]}.`,
      });
    } else {
      findings.push({ severity: "info", check: "filesystem:world-writable", detail: "No world-writable files found under /etc (depth 2)." });
    }

    findings.push({ severity: "info", check: "identity", detail: (sections.IDENTITY ?? "").trim() || "unknown" });

    return { name: "security_posture", collectedAt: new Date(), findings };
  }

  async performAction(target: ConnectorTarget, action: string, params?: Record<string, unknown>): Promise<ActionResult> {
    if (!SSH_ACTIONS.includes(action as SshAction)) {
      return { success: false, detail: `Unsupported SSH action "${action}". Supported: ${SSH_ACTIONS.join(", ")}` };
    }
    const command = this.buildActionCommand(action as SshAction, params);
    const result = await this.exec(target, command, 30_000);
    const { output } = capOutput(`${result.stdout}${result.stderr}`);
    return { success: result.exitCode === 0, detail: output };
  }

  private buildActionCommand(action: SshAction, params?: Record<string, unknown>): string {
    switch (action) {
      case "service_start":
        return `systemctl start ${requireSafeIdentifier(params?.service, "service")} 2>&1 && systemctl is-active ${requireSafeIdentifier(params?.service, "service")}`;
      case "service_stop":
        return `systemctl stop ${requireSafeIdentifier(params?.service, "service")} 2>&1`;
      case "service_restart":
        return `systemctl restart ${requireSafeIdentifier(params?.service, "service")} 2>&1 && systemctl is-active ${requireSafeIdentifier(params?.service, "service")}`;
      case "service_enable":
        return `systemctl enable ${requireSafeIdentifier(params?.service, "service")} 2>&1`;
      case "service_disable":
        return `systemctl disable ${requireSafeIdentifier(params?.service, "service")} 2>&1`;
      case "package_install": {
        const pkg = requireSafeIdentifier(params?.package, "package");
        return (
          `(command -v apt-get >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg} 2>&1) || ` +
          `(command -v dnf >/dev/null 2>&1 && dnf install -y ${pkg} 2>&1) || ` +
          `(command -v yum >/dev/null 2>&1 && yum install -y ${pkg} 2>&1) || ` +
          `(command -v apk >/dev/null 2>&1 && apk add ${pkg} 2>&1) || ` +
          `echo 'no supported package manager found (apt-get/dnf/yum/apk)'`
        );
      }
      case "reboot":
        return "nohup shutdown -r now >/dev/null 2>&1 &";
    }
  }

  private exec(target: ConnectorTarget, command: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult & { newlyPinnedHostKeyFingerprint?: string }> {
    const credential = target.credential?.payload as SshCredentialPayload | undefined;
    if (!credential?.username || (!credential.password && !credential.privateKey)) {
      return Promise.reject(
        new ConnectorError(`No SSH credential (username + password or privateKey) attached to device ${target.deviceId}`),
      );
    }

    let newlyPinnedHostKeyFingerprint: string | undefined;
    let hostKeyRejected = false;

    const connectConfig: ConnectConfig = {
      host: target.host,
      port: credential.port ?? 22,
      username: credential.username,
      password: credential.password,
      privateKey: credential.privateKey,
      passphrase: credential.passphrase,
      readyTimeout: Math.min(timeoutMs, 15_000),
      hostVerifier: (keyHash: Buffer) => {
        const fingerprint = keyHash.toString("base64");
        const verification = this.verifyHostKey(target.host, fingerprint, credential.hostKeyFingerprint);
        newlyPinnedHostKeyFingerprint = verification.newlyPinnedFingerprint;
        hostKeyRejected = !verification.ok;
        return verification.ok;
      },
    };

    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      const settle = () => {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settle();
        client.end();
        resolve({ exitCode: null, stdout: "", stderr: "command timed out", timedOut: true });
      }, timeoutMs);

      const onAbort = () => {
        if (settled) return;
        settle();
        client.end();
        resolve({ exitCode: null, stdout: "", stderr: "command cancelled", timedOut: false, cancelled: true });
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      client
        .on("ready", () => {
          client.exec(command, (err, stream) => {
            if (err) {
              client.end();
              if (!settled) {
                settle();
                reject(new ConnectorError(`exec failed: ${err.message}`, err));
              }
              return;
            }
            let stdout = "";
            let stderr = "";
            stream
              .on("close", (code: number | null) => {
                client.end();
                if (!settled) {
                  settle();
                  resolve({ exitCode: code, stdout, stderr, timedOut: false, newlyPinnedHostKeyFingerprint });
                }
              })
              .on("data", (data: Buffer) => {
                stdout += data.toString("utf8");
              })
              .stderr.on("data", (data: Buffer) => {
                stderr += data.toString("utf8");
              });
          });
        })
        .on("error", (err) => {
          if (!settled) {
            settle();
            if (hostKeyRejected) {
              reject(new ConnectorError(`SSH host key for ${target.host} does not match the pinned fingerprint — refusing to connect (possible MITM or a legitimately reimaged host; verify and update the credential's hostKeyFingerprint if the change is expected).`, err));
            } else {
              reject(new ConnectorError(`SSH connection failed: ${err.message}`, err));
            }
          }
        })
        .connect(connectConfig);
    });
  }
}

/** Splits the `security_posture` probe's `echo ---LABEL---`-delimited
 * output back into named sections. */
function parseSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = text.split(/^---([A-Z]+)---$/m);
  for (let i = 1; i < parts.length; i += 2) {
    sections[parts[i]] = parts[i + 1] ?? "";
  }
  return sections;
}

function clampLines(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : 200;
  return Math.min(Math.max(n, 1), 1000);
}
