import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { InfraDeviceCategory, InfraManagementProtocol } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { InfraDevicesService } from "../devices/devices.service";
import { ImportCandidateDto } from "./dto/import-candidate.dto";
import { guessVendorFromMac } from "./mac-vendor-lookup";
import { isIpWithinCidr, NetworkDiscoveryService } from "./network-discovery.service";

/** A TCP port worth probing, and the protocol it's a *hint* toward —
 * never a confirmed capability (see `probeManagementPorts`). Kept to a
 * small, deliberately curated list rather than every port a connector
 * might ever use, so this stays a cheap, honest hint instead of
 * something that looks like a real port scanner. */
const CANDIDATE_MANAGEMENT_PORTS: ReadonlyArray<{ port: number; protocolHint: InfraManagementProtocol }> = [
  { port: 22, protocolHint: InfraManagementProtocol.SSH },
  { port: 8006, protocolHint: InfraManagementProtocol.PROXMOX_API },
  { port: 5985, protocolHint: InfraManagementProtocol.WINDOWS_WINRM },
  { port: 5986, protocolHint: InfraManagementProtocol.WINDOWS_WINRM },
];

export interface PortProbeResult {
  port: number;
  open: boolean;
  protocolHint: InfraManagementProtocol;
}

export interface DetectedLocalNetwork {
  interfaceName?: string;
  localAddress?: string;
  subnetCidr: string | null;
  gateway?: string;
}

export interface DiscoveryCandidate {
  ip: string;
  mac?: string;
  vendorGuess?: string;
  isGateway: boolean;
  alreadyKnown: boolean;
  existingDeviceId?: string;
  existingDeviceName?: string;
  suggestedName: string;
  suggestedCategory: InfraDeviceCategory;
}

export interface NetworkScanResult extends DetectedLocalNetwork {
  scannedAt: Date;
  usedNmap: boolean;
  candidates: DiscoveryCandidate[];
}

/**
 * Orchestrates the "Discover My Network" workflow (PRODUCT_SPEC.md
 * section 3): combines the raw OS probes in `network-discovery.service`
 * with existing-inventory matching and a best-effort vendor guess, but
 * never writes anything to the database on its own — a scan is read-only
 * by design. `importCandidate` is the one method that mutates inventory,
 * and only for a candidate the operator explicitly chose to import.
 */
@Injectable()
export class DiscoveryScanService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NetworkDiscoveryService) private readonly networkDiscovery: NetworkDiscoveryService,
    @Inject(InfraDevicesService) private readonly devicesService: InfraDevicesService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  async detectLocalNetwork(): Promise<DetectedLocalNetwork> {
    const interfaces = this.networkDiscovery.listLocalInterfaces();
    const active = interfaces.find((i) => i.family === "IPv4" && !i.internal);
    const gateway = await this.networkDiscovery.getDefaultGateway();
    return {
      interfaceName: active?.name,
      localAddress: active?.address,
      subnetCidr: active?.cidr ?? null,
      gateway,
    };
  }

  /** Authorization for *which* subnet to scan happens one layer up, in
   * the controller/frontend ("display the proposed discovery scope...
   * allow me to select the network" — the operator always sees and
   * confirms `cidr` before this runs). This method never picks a target
   * on its own beyond what it's told to scan. */
  async scanSubnet(environmentId: string, cidr?: string): Promise<NetworkScanResult> {
    const local = await this.detectLocalNetwork();
    const effectiveCidr = cidr ?? local.subnetCidr;
    if (!effectiveCidr) {
      throw new BadRequestException(
        "Could not determine a local subnet automatically — pass one explicitly (e.g. 192.168.0.0/24).",
      );
    }

    const existingDevicesPromise = this.prisma.infraDevice.findMany({
      where: { environmentId },
      select: { id: true, name: true, ipAddresses: true },
    });

    // Run the nmap ping sweep *before* reading the ARP table, not after
    // — resolving each host's ARP entry is a side effect of nmap's own
    // probe traffic, so capturing ARP first (this method's original
    // order) missed MACs for anything whose cache entry had already
    // expired (observed live: a real scan against a populated LAN
    // returned zero MACs at all until this was reordered).
    let nmapHosts: string[] = [];
    let usedNmap = false;
    try {
      nmapHosts = await this.networkDiscovery.runNmapPingSweep(effectiveCidr);
      usedNmap = true;
    } catch {
      // nmap is optional — ARP alone still produces a useful result.
    }

    const [arpNeighbors, existingDevices] = await Promise.all([this.networkDiscovery.listArpNeighbors(), existingDevicesPromise]);

    const macByIp = new Map<string, string | undefined>();
    for (const neighbor of arpNeighbors) macByIp.set(neighbor.ip, neighbor.mac);
    for (const ip of nmapHosts) if (!macByIp.has(ip)) macByIp.set(ip, undefined);

    const existingByIp = new Map<string, { id: string; name: string }>();
    for (const device of existingDevices) {
      for (const ip of device.ipAddresses) existingByIp.set(ip, { id: device.id, name: device.name });
    }

    const candidates: DiscoveryCandidate[] = [...macByIp.entries()].map(([ip, mac]) => {
      const isGateway = ip === local.gateway;
      const vendorGuess = mac ? guessVendorFromMac(mac) : undefined;
      const existing = existingByIp.get(ip);
      const suggestedCategory: InfraDeviceCategory = isGateway
        ? InfraDeviceCategory.ROUTER
        : vendorGuess === "NETGEAR"
          ? InfraDeviceCategory.MANAGED_SWITCH
          : InfraDeviceCategory.GENERIC_NETWORK_DEVICE;
      return {
        ip,
        mac,
        vendorGuess,
        isGateway,
        alreadyKnown: Boolean(existing),
        existingDeviceId: existing?.id,
        existingDeviceName: existing?.name,
        suggestedName: isGateway ? "Router / Gateway" : (vendorGuess ?? ip),
        suggestedCategory,
      };
    });

    candidates.sort((a, b) => Number(b.isGateway) - Number(a.isGateway) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));

    return { ...local, subnetCidr: effectiveCidr, scannedAt: new Date(), usedNmap, candidates };
  }

  /** Refuses any target outside the subnet TRACE's own machine was
   * actually detected on — the same "explicitly authorized ranges"
   * boundary `scanSubnet` already enforces by construction (it only
   * ever scans a cidr derived from this machine's own interface),
   * extended to the onboarding workflow's single-IP operations, which
   * don't go through a subnet scan first. */
  async assertAuthorizedTarget(ip: string): Promise<void> {
    const local = await this.detectLocalNetwork();
    if (!local.subnetCidr || !isIpWithinCidr(ip, local.subnetCidr)) {
      throw new ForbiddenException(
        `${ip} is outside the subnet TRACE's own machine is on (${local.subnetCidr ?? "undetected"}) — onboarding is restricted to explicitly authorized local ranges.`,
      );
    }
  }

  /** A bare TCP-connect probe against a small, curated set of
   * well-known management ports — never a full port scan, never a
   * banner/handshake read. Each result is a *hint*, not a claim: the
   * caller (device-onboarding.service.ts) must still get a real
   * connector call to succeed before treating a protocol as actually
   * supported (PRODUCT_SPEC: "do not assume a device supports SSH
   * merely because port 22 is open"). SNMP has no entry here — it's
   * UDP, so a TCP-connect result would tell you nothing real. */
  async probeManagementPorts(ip: string): Promise<PortProbeResult[]> {
    return Promise.all(
      CANDIDATE_MANAGEMENT_PORTS.map(async ({ port, protocolHint }) => ({
        port,
        protocolHint,
        open: await this.networkDiscovery.probeTcpPort(ip, port),
      })),
    );
  }

  /** Creates a new device, or — if a device with this IP already
   * exists — merges the discovered MAC into it instead of duplicating
   * the record (PRODUCT_SPEC.md section 3: "Avoid duplicate device
   * records"). */
  async importCandidate(environmentId: string, actor: string, dto: ImportCandidateDto) {
    const existing = await this.prisma.infraDevice.findFirst({
      where: { environmentId, ipAddresses: { has: dto.ip } },
    });

    if (existing) {
      const macAddresses = dto.mac && !existing.macAddresses.includes(dto.mac)
        ? [...existing.macAddresses, dto.mac]
        : existing.macAddresses;
      const updated = await this.devicesService.update(environmentId, existing.id, actor, { macAddresses });
      await this.auditLog.record({
        environmentId,
        actor,
        action: "discovery.import",
        targetType: "InfraDevice",
        targetId: existing.id,
        outcome: "success",
        detail: { ip: dto.ip, mac: dto.mac, result: "merged-into-existing" },
      });
      return { device: updated, action: "merged" as const };
    }

    const created = await this.devicesService.create(environmentId, {
      name: dto.name,
      category: dto.category,
      manufacturer: dto.vendorGuess,
      ipAddresses: [dto.ip],
      macAddresses: dto.mac ? [dto.mac] : [],
    });
    const withSource = await this.prisma.infraDevice.update({
      where: { id: created.id },
      data: { discoverySource: "discovery:scan" },
    });

    await this.auditLog.record({
      environmentId,
      actor,
      action: "discovery.import",
      targetType: "InfraDevice",
      targetId: created.id,
      outcome: "success",
      detail: { ip: dto.ip, mac: dto.mac, result: "created" },
    });

    return { device: withSource, action: "created" as const };
  }
}
