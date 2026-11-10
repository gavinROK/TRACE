import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { BadRequestException, Injectable } from "@nestjs/common";

const execFileAsync = promisify(execFile);
const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;
const CIDR_PATTERN = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

export interface LocalInterfaceInfo {
  name: string;
  address: string;
  family: "IPv4" | "IPv6";
  mac: string;
  internal: boolean;
  cidr: string | null;
}

export interface ArpNeighbor {
  ip: string;
  mac: string;
  interface?: string;
}

/**
 * Discovery against only this machine's own local network stack — no
 * device mutation happens here (see proxmox-discovery.service.ts for
 * the part that writes InfraDevice rows). PRODUCT_SPEC.md section 6:
 * "Discovery must operate only against networks I have explicitly
 * authorized" — the inputs this service touches (ping targets, nmap
 * subnets) always come from the operator's own request, never a list
 * TRACE invents. Every external command runs via execFile with a fixed
 * argument array — never a shell string — so none of this is
 * vulnerable to shell injection even though the IP/CIDR is also
 * validated before use.
 */
@Injectable()
export class NetworkDiscoveryService {
  listLocalInterfaces(): LocalInterfaceInfo[] {
    const interfaces = networkInterfaces();
    const result: LocalInterfaceInfo[] = [];
    for (const [name, addresses] of Object.entries(interfaces)) {
      for (const addr of addresses ?? []) {
        result.push({
          name,
          address: addr.address,
          family: addr.family,
          mac: addr.mac,
          internal: addr.internal,
          cidr: addr.cidr,
        });
      }
    }
    return result;
  }

  /** Parses `route -n get default` (macOS/BSD) for the current default
   * gateway — the strongest available signal for "this is probably the
   * router," though never asserted as fact (see
   * `discovery-scan.service.ts`, which only ever labels it a
   * *candidate*). Returns undefined rather than throwing if there is no
   * default route (e.g. offline). */
  async getDefaultGateway(): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync("route", ["-n", "get", "default"]);
      const match = /gateway:\s*([\d.]+)/.exec(stdout);
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  /** Parses `arp -a` (macOS/BSD format: "host (ip) at mac on iface ..."). */
  async listArpNeighbors(): Promise<ArpNeighbor[]> {
    const { stdout } = await execFileAsync("arp", ["-a"]);
    const neighbors: ArpNeighbor[] = [];
    const lineRegex = /\(([\d.]+)\) at ([0-9a-fA-F:]+)(?:\s+on\s+(\S+))?/;
    for (const line of stdout.split("\n")) {
      const match = lineRegex.exec(line);
      if (match) {
        neighbors.push({ ip: match[1], mac: match[2], interface: match[3] });
      }
    }
    return neighbors;
  }

  /** One ICMP echo, ≤2s. Returns false on any non-zero exit (timeout,
   * host unreachable, unknown host) rather than throwing — "unreachable"
   * is a normal, expected result here, not an error condition. */
  async checkReachability(ip: string): Promise<boolean> {
    this.assertIPv4(ip);
    try {
      await execFileAsync("ping", ["-c", "1", "-t", "2", ip]);
      return true;
    } catch {
      return false;
    }
  }

  /** Ping-sweep only (`-sn`) — never a port scan. Requires nmap to
   * already be installed; this never attempts to install it. */
  async runNmapPingSweep(cidr: string): Promise<string[]> {
    this.assertCIDR(cidr);
    try {
      await execFileAsync("which", ["nmap"]);
    } catch {
      throw new BadRequestException("nmap is not installed on this machine — install it (e.g. `brew install nmap`) to use this optional discovery method.");
    }
    const { stdout } = await execFileAsync("nmap", ["-sn", cidr], { timeout: 60_000 });
    const hosts: string[] = [];
    const hostRegex = /Nmap scan report for (?:\S+ \()?([\d.]+)\)?/;
    for (const line of stdout.split("\n")) {
      const match = hostRegex.exec(line);
      if (match) hosts.push(match[1]);
    }
    return hosts;
  }

  private assertIPv4(ip: string): void {
    if (!IPV4_PATTERN.test(ip)) {
      throw new BadRequestException(`"${ip}" is not a valid IPv4 address`);
    }
  }

  private assertCIDR(cidr: string): void {
    if (!CIDR_PATTERN.test(cidr)) {
      throw new BadRequestException(`"${cidr}" is not a valid IPv4 CIDR range (e.g. 192.168.1.0/24)`);
    }
  }
}
