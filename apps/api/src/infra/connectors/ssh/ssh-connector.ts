import { Injectable, Logger } from "@nestjs/common";
import { InfraManagementProtocol, InfraMetricKind } from "@prisma/client";
import { Client, type ConnectConfig } from "ssh2";
import type {
  CommandResult,
  ConnectorCapability,
  ConnectorTarget,
  HealthResult,
  InfraConnector,
  MetricReading,
} from "../connector.types";
import { ConnectorError } from "../connector.types";

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
    return ["getHealth", "getMetrics", "executeCommand"];
  }

  /** Records the host key fingerprint seen on first successful connect,
   * so later connections can detect a changed key instead of silently
   * trusting whatever key the host presents (ssh2's default). Kept
   * in-memory per process for now — see docs/ARCHITECTURE.md "known
   * limitations" for persisting this across restarts. */
  private verifyHostKey(host: string, fingerprint: string, pinned?: string): boolean {
    const effectivePinned = pinned ?? this.knownHostKeys.get(host);
    if (!effectivePinned) {
      this.knownHostKeys.set(host, fingerprint);
      this.logger.warn(
        `Trust-on-first-use: recorded host key for ${host}. Pin this fingerprint in the device's credential record to detect future changes.`,
      );
      return true;
    }
    return effectivePinned === fingerprint;
  }

  async getHealth(target: ConnectorTarget): Promise<HealthResult> {
    try {
      const result = await this.exec(target, "true", 5_000);
      return {
        onlineState: result.exitCode === 0 ? "ONLINE" : "OFFLINE",
        checkedAt: new Date(),
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
    return this.exec(target, command, options.timeoutMs, options.signal);
  }

  private exec(target: ConnectorTarget, command: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
    const credential = target.credential?.payload as SshCredentialPayload | undefined;
    if (!credential?.username || (!credential.password && !credential.privateKey)) {
      return Promise.reject(
        new ConnectorError(`No SSH credential (username + password or privateKey) attached to device ${target.deviceId}`),
      );
    }

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
        return this.verifyHostKey(target.host, fingerprint, credential.hostKeyFingerprint);
      },
    };

    return new Promise<CommandResult>((resolve, reject) => {
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
                  resolve({ exitCode: code, stdout, stderr, timedOut: false });
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
            reject(new ConnectorError(`SSH connection failed: ${err.message}`, err));
          }
        })
        .connect(connectConfig);
    });
  }
}
