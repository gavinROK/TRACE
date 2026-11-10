import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InfraDeviceCategory, InfraManagementProtocol, InfraRelationshipType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { ConnectorRegistryService } from "../connectors/connector-registry.service";
import { CredentialsService } from "../credentials/credentials.service";

export interface ProxmoxDiscoveryResult {
  created: number;
  updated: number;
  totalDiscovered: number;
}

/**
 * Enumerates a Proxmox host's VMs/containers (via ProxmoxConnector.discover)
 * and reconciles them into InfraDevice/InfraRelationship rows — the part
 * of discovery that actually mutates the topology (PRODUCT_SPEC.md
 * section 6: "refresh discovery without deleting previously stored
 * device information"). Matching is by (environmentId, name): an
 * existing device is updated in place, never duplicated or removed —
 * nothing already enrolled (credentials, management protocols the
 * operator set) is touched by a re-run.
 */
@Injectable()
export class ProxmoxDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorRegistry: ConnectorRegistryService,
    private readonly credentialsService: CredentialsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async discoverFromHypervisor(environmentId: string, actor: string, hypervisorDeviceId: string): Promise<ProxmoxDiscoveryResult> {
    const hypervisor = await this.prisma.infraDevice.findFirst({ where: { id: hypervisorDeviceId, environmentId } });
    if (!hypervisor) throw new NotFoundException("Device not found");

    const host = hypervisor.ipAddresses[0];
    if (!host) throw new BadRequestException(`Device "${hypervisor.name}" has no IP address recorded`);

    const credential = await this.credentialsService.getDecryptedForDevice(environmentId, hypervisorDeviceId, InfraManagementProtocol.PROXMOX_API);
    if (!credential) throw new BadRequestException(`No Proxmox API token enrolled for device "${hypervisor.name}"`);

    const connector = this.connectorRegistry.require(InfraManagementProtocol.PROXMOX_API);
    if (!connector.discover) throw new BadRequestException("Proxmox connector does not support discovery");

    const assets = await connector.discover({ deviceId: hypervisorDeviceId, host, credential });
    const guests = assets.filter((asset) => asset.category !== "PHYSICAL_SERVER");

    let created = 0;
    let updated = 0;
    for (const guest of guests) {
      const category = guest.category === "CONTAINER" ? InfraDeviceCategory.CONTAINER : InfraDeviceCategory.VIRTUAL_MACHINE;
      const existing = await this.prisma.infraDevice.findUnique({
        where: { environmentId_name: { environmentId, name: guest.name } },
      });

      const guestDevice = existing
        ? await this.prisma.infraDevice.update({
            where: { id: existing.id },
            data: { category, parentDeviceId: hypervisorDeviceId, notes: JSON.stringify(guest.metadata ?? {}) },
          })
        : await this.prisma.infraDevice.create({
            data: {
              environmentId,
              name: guest.name,
              category,
              parentDeviceId: hypervisorDeviceId,
              ipAddresses: [],
              macAddresses: [],
              managementProtocols: [],
              notes: JSON.stringify(guest.metadata ?? {}),
              discoverySource: "discovery:proxmox",
            },
          });
      if (existing) {
        updated++;
      } else {
        created++;
      }

      await this.prisma.infraRelationship.upsert({
        where: {
          fromDeviceId_toDeviceId_type: {
            fromDeviceId: hypervisorDeviceId,
            toDeviceId: guestDevice.id,
            type: InfraRelationshipType.HOSTS,
          },
        },
        create: {
          environmentId,
          fromDeviceId: hypervisorDeviceId,
          toDeviceId: guestDevice.id,
          type: InfraRelationshipType.HOSTS,
          kind: "VERIFIED",
        },
        update: { kind: "VERIFIED" },
      });
    }

    await this.auditLog.record({
      environmentId,
      actor,
      action: "discovery.proxmox",
      targetType: "InfraDevice",
      targetId: hypervisorDeviceId,
      outcome: "success",
      detail: { created, updated, totalDiscovered: guests.length },
    });

    return { created, updated, totalDiscovered: guests.length };
  }
}
