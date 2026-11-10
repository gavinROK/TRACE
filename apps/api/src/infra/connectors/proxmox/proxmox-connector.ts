import { Injectable } from "@nestjs/common";
import { InfraManagementProtocol, InfraMetricKind } from "@prisma/client";
import * as https from "node:https";
import type {
  ActionResult,
  ConnectorCapability,
  ConnectorTarget,
  DiscoveredAsset,
  HealthResult,
  InfraConnector,
  MetricReading,
} from "../connector.types";
import { ConnectorError } from "../connector.types";

interface ProxmoxCredentialPayload {
  /** e.g. "root@pam" */
  tokenUser: string;
  tokenId: string;
  tokenSecret: string;
  port?: number;
  /** Proxmox's web UI serves a self-signed cert by default. Set this
   * true only once the host presents a certificate TRACE actually
   * trusts (its own CA, or a replaced cert) — defaulting it false
   * (verify) rather than true (skip verification) means a homelab's
   * untouched self-signed install fails closed until the operator
   * explicitly accepts the risk, instead of silently trusting any TLS
   * endpoint that happens to answer on the configured port. */
  allowSelfSigned?: boolean;
}

interface ProxmoxNodeStatus {
  uptime: number;
  cpu: number;
  memory: { used: number; total: number };
  rootfs: { used: number; total: number };
}

const SUPPORTED_ACTIONS = new Set(["start", "stop", "shutdown", "reboot"]);

@Injectable()
export class ProxmoxConnector implements InfraConnector {
  readonly protocol = InfraManagementProtocol.PROXMOX_API;

  getCapabilities(): ConnectorCapability[] {
    return ["discover", "getHealth", "getMetrics", "performAction"];
  }

  async getHealth(target: ConnectorTarget): Promise<HealthResult> {
    const node = this.requireNode(target);
    try {
      await this.request<ProxmoxNodeStatus>(target, `/nodes/${node}/status`);
      return { onlineState: "ONLINE", checkedAt: new Date() };
    } catch (error) {
      return {
        onlineState: "OFFLINE",
        checkedAt: new Date(),
        detail: error instanceof Error ? error.message : "unreachable",
      };
    }
  }

  async getMetrics(target: ConnectorTarget): Promise<MetricReading[]> {
    const node = this.requireNode(target);
    const status = await this.request<ProxmoxNodeStatus>(target, `/nodes/${node}/status`);
    const collectedAt = new Date();
    const readings: MetricReading[] = [
      { kind: InfraMetricKind.CPU_UTILIZATION, value: status.cpu * 100, unit: "percent", collectedAt },
      {
        kind: InfraMetricKind.MEMORY_UTILIZATION,
        value: (status.memory.used / status.memory.total) * 100,
        unit: "percent",
        collectedAt,
      },
      { kind: InfraMetricKind.MEMORY_USED_BYTES, value: status.memory.used, unit: "bytes", collectedAt },
      { kind: InfraMetricKind.MEMORY_TOTAL_BYTES, value: status.memory.total, unit: "bytes", collectedAt },
      { kind: InfraMetricKind.UPTIME_SECONDS, value: status.uptime, unit: "seconds", collectedAt },
    ];
    if (status.rootfs?.total) {
      readings.push({
        kind: InfraMetricKind.DISK_UTILIZATION,
        label: "/",
        value: (status.rootfs.used / status.rootfs.total) * 100,
        unit: "percent",
        collectedAt,
      });
      readings.push({ kind: InfraMetricKind.DISK_USED_BYTES, label: "/", value: status.rootfs.used, unit: "bytes", collectedAt });
      readings.push({ kind: InfraMetricKind.DISK_TOTAL_BYTES, label: "/", value: status.rootfs.total, unit: "bytes", collectedAt });
    }
    return readings;
  }

  /** Enumerates every node, plus every VM and container on each node. */
  async discover(target: ConnectorTarget): Promise<DiscoveredAsset[]> {
    const nodes = await this.request<Array<{ node: string }>>(target, "/nodes");
    const assets: DiscoveredAsset[] = [];
    for (const { node } of nodes) {
      assets.push({ name: node, host: target.host, category: "PHYSICAL_SERVER", metadata: { node } });
      const [qemu, lxc] = await Promise.all([
        this.request<Array<{ vmid: number; name: string; status: string }>>(target, `/nodes/${node}/qemu`),
        this.request<Array<{ vmid: number; name: string; status: string }>>(target, `/nodes/${node}/lxc`),
      ]);
      for (const vm of qemu) {
        assets.push({
          name: vm.name,
          host: target.host,
          category: "VIRTUAL_MACHINE",
          metadata: { node, vmid: vm.vmid, status: vm.status, parentHost: node },
        });
      }
      for (const ct of lxc) {
        assets.push({
          name: ct.name,
          host: target.host,
          category: "CONTAINER",
          metadata: { node, vmid: ct.vmid, status: ct.status, parentHost: node },
        });
      }
    }
    return assets;
  }

  /** start/stop/shutdown/reboot a VM or container identified by
   * target.metadata.{node,vmid,guestType}. */
  async performAction(target: ConnectorTarget, action: string): Promise<ActionResult> {
    if (!SUPPORTED_ACTIONS.has(action)) {
      return { success: false, detail: `Unsupported action "${action}". Supported: ${[...SUPPORTED_ACTIONS].join(", ")}` };
    }
    const node = this.requireNode(target);
    const vmid = target.metadata?.vmid;
    const guestType = target.metadata?.guestType === "lxc" ? "lxc" : "qemu";
    if (!vmid) {
      return { success: false, detail: "Target has no vmid — performAction only applies to a VM/container, not a node." };
    }
    try {
      await this.request(target, `/nodes/${node}/${guestType}/${vmid}/status/${action}`, "POST");
      return { success: true, detail: `${action} issued for ${guestType} ${vmid} on ${node}` };
    } catch (error) {
      return { success: false, detail: error instanceof Error ? error.message : "request failed" };
    }
  }

  private requireNode(target: ConnectorTarget): string {
    const node = target.metadata?.node;
    if (typeof node !== "string" || node.length === 0) {
      throw new ConnectorError(`Device ${target.deviceId} has no Proxmox node name in metadata.node`);
    }
    return node;
  }

  private async request<T>(target: ConnectorTarget, path: string, method: "GET" | "POST" = "GET"): Promise<T> {
    const credential = target.credential?.payload as ProxmoxCredentialPayload | undefined;
    if (!credential?.tokenUser || !credential.tokenId || !credential.tokenSecret) {
      throw new ConnectorError(`No Proxmox API token attached to device ${target.deviceId}`);
    }
    const port = credential.port ?? 8006;
    const body = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          host: target.host,
          port,
          path: `/api2/json${path}`,
          method,
          rejectUnauthorized: !credential.allowSelfSigned ? true : false,
          headers: {
            Authorization: `PVEAPIToken=${credential.tokenUser}!${credential.tokenId}=${credential.tokenSecret}`,
          },
          timeout: 10_000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new ConnectorError(`Proxmox API ${method} ${path} returned HTTP ${res.statusCode}: ${data}`));
            } else {
              resolve(data);
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new ConnectorError(`Proxmox API ${method} ${path} timed out`)));
      req.on("error", (err) => reject(new ConnectorError(`Proxmox API request failed: ${err.message}`, err)));
      req.end();
    });

    try {
      const parsed = JSON.parse(body) as { data: T };
      return parsed.data;
    } catch (error) {
      throw new ConnectorError(`Proxmox API ${path} returned non-JSON response`, error);
    }
  }
}
