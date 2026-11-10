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
  /** API token auth (recommended for anything beyond first testing — an
   * API token can be revoked on its own, independent of the account's
   * login password). e.g. tokenUser "root@pam". */
  tokenUser?: string;
  tokenId?: string;
  tokenSecret?: string;
  /** Password auth — exchanged for a short-lived ticket on every call
   * (PRODUCT_SPEC.md section 7: "allow a deliberate, clearly warned...
   * exception," here for using the account password directly instead of
   * a scoped API token — fine to get started, worth replacing with a
   * token for anything long-running). e.g. username "root@pam". */
  username?: string;
  password?: string;
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

interface ProxmoxTicket {
  ticket: string;
  CSRFPreventionToken: string;
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
    try {
      const node = await this.requireNode(target);
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
    const node = await this.requireNode(target);
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
    const vmid = target.metadata?.vmid;
    const guestType = target.metadata?.guestType === "lxc" ? "lxc" : "qemu";
    if (!vmid) {
      return { success: false, detail: "Target has no vmid — performAction only applies to a VM/container, not a node." };
    }
    try {
      const node = await this.requireNode(target);
      await this.request(target, `/nodes/${node}/${guestType}/${vmid}/status/${action}`, "POST");
      return { success: true, detail: `${action} issued for ${guestType} ${vmid} on ${node}` };
    } catch (error) {
      return { success: false, detail: error instanceof Error ? error.message : "request failed" };
    }
  }

  /** Most homelab enrollments never set `metadata.node` explicitly —
   * it's only populated today for guests created via
   * proxmox-discovery.service.ts, not for the hypervisor device itself
   * (confirmed live: a manually-enrolled Proxmox host's getHealth call
   * threw here every time until this fallback was added). For the
   * common single-node case, asking Proxmox's own `/nodes` list and
   * using its one entry is unambiguous; a real cluster (more than one
   * node) still requires `metadata.node` to be set explicitly, since
   * guessing which node a device means would be exactly the kind of
   * invented fact the product spec forbids. */
  private async requireNode(target: ConnectorTarget): Promise<string> {
    const node = target.metadata?.node;
    if (typeof node === "string" && node.length > 0) {
      return node;
    }
    const nodes = await this.request<Array<{ node: string }>>(target, "/nodes");
    if (nodes.length === 1) {
      return nodes[0].node;
    }
    throw new ConnectorError(
      nodes.length === 0
        ? `Device ${target.deviceId}: Proxmox reported no nodes`
        : `Device ${target.deviceId} has ${nodes.length} Proxmox nodes — set metadata.node to disambiguate which one this device means`,
    );
  }

  private async request<T>(target: ConnectorTarget, path: string, method: "GET" | "POST" = "GET"): Promise<T> {
    const credential = target.credential?.payload as ProxmoxCredentialPayload | undefined;
    if (!credential) {
      throw new ConnectorError(`No Proxmox credential attached to device ${target.deviceId}`);
    }
    const port = credential.port ?? 8006;
    const rejectUnauthorized = !credential.allowSelfSigned;

    const headers: Record<string, string> = {};
    if (credential.tokenUser && credential.tokenId && credential.tokenSecret) {
      headers.Authorization = `PVEAPIToken=${credential.tokenUser}!${credential.tokenId}=${credential.tokenSecret}`;
    } else if (credential.username && credential.password) {
      const ticket = await this.obtainTicket(target.host, port, credential.username, credential.password, rejectUnauthorized);
      headers.Cookie = `PVEAuthCookie=${ticket.ticket}`;
      if (method !== "GET") headers["CSRFPreventionToken"] = ticket.CSRFPreventionToken;
    } else {
      throw new ConnectorError(
        `Device ${target.deviceId}'s Proxmox credential has neither an API token (tokenUser/tokenId/tokenSecret) nor a username/password`,
      );
    }

    const body = await this.rawRequest(target.host, port, `/api2/json${path}`, method, headers, rejectUnauthorized);
    try {
      const parsed = JSON.parse(body) as { data: T };
      return parsed.data;
    } catch (error) {
      throw new ConnectorError(`Proxmox API ${path} returned non-JSON response`, error);
    }
  }

  /** Exchanges a username/password for a short-lived (~2h) session
   * ticket. Called fresh on every request rather than cached — simpler
   * than tracking expiry across a stateless connector, and an
   * acceptable extra round-trip at homelab scale. */
  private async obtainTicket(
    host: string,
    port: number,
    username: string,
    password: string,
    rejectUnauthorized: boolean,
  ): Promise<ProxmoxTicket> {
    const formBody = new URLSearchParams({ username, password }).toString();
    const body = await this.rawRequest(
      host,
      port,
      "/api2/json/access/ticket",
      "POST",
      { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(Buffer.byteLength(formBody)) },
      rejectUnauthorized,
      formBody,
    );
    try {
      const parsed = JSON.parse(body) as { data: ProxmoxTicket };
      if (!parsed.data?.ticket) throw new Error("response had no ticket");
      return parsed.data;
    } catch (error) {
      throw new ConnectorError(`Proxmox login failed for ${username}@${host}:${port}`, error);
    }
  }

  private rawRequest(
    host: string,
    port: number,
    path: string,
    method: "GET" | "POST",
    headers: Record<string, string>,
    rejectUnauthorized: boolean,
    requestBody?: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const req = https.request(
        { host, port, path, method, rejectUnauthorized, headers, timeout: 10_000 },
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
      if (requestBody) req.write(requestBody);
      req.end();
    });
  }
}
