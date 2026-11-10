import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { ConnectorRegistryService } from "../connectors/connector-registry.service";
import { CredentialsService } from "../credentials/credentials.service";
import { CreateInfraDeviceDto } from "./dto/create-device.dto";
import { UpdateInfraDeviceDto } from "./dto/update-device.dto";

const WITH_RELATIONS = {
  include: {
    parentDevice: { select: { id: true, name: true } },
    children: { select: { id: true, name: true, category: true, onlineState: true } },
  },
} satisfies Prisma.InfraDeviceDefaultArgs;
type InfraDeviceWithRelations = Prisma.InfraDeviceGetPayload<typeof WITH_RELATIONS>;

@Injectable()
export class InfraDevicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConnectorRegistryService) private readonly connectorRegistry: ConnectorRegistryService,
    @Inject(CredentialsService) private readonly credentialsService: CredentialsService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  async list(environmentId: string) {
    const devices = await this.prisma.infraDevice.findMany({
      where: { environmentId },
      orderBy: { name: "asc" },
      ...WITH_RELATIONS,
    });
    return devices.map((device) => this.toSummary(device));
  }

  async get(environmentId: string, deviceId: string) {
    const device = await this.findOrThrow(environmentId, deviceId);
    const [recentMetrics, credentials] = await Promise.all([
      this.prisma.infraMetricSample.findMany({
        where: { deviceId },
        orderBy: { collectedAt: "desc" },
        take: 50,
      }),
      this.credentialsService.listForEnvironment(environmentId).then((all) => all.filter((c) => c.deviceId === deviceId)),
    ]);
    return {
      ...this.toSummary(device),
      notes: device.notes,
      recentMetrics,
      credentials,
      capabilities: this.getCapabilities(device),
    };
  }

  /** Resolved strictly by (environmentId, name) — the schema's unique
   * index on that pair means this can never be ambiguous within one
   * environment (PRODUCT_SPEC.md section 9: "never silently execute a
   * command against a different device if name resolution is
   * ambiguous"). A name that doesn't exist throws, rather than falling
   * back to any kind of fuzzy match. */
  async resolveByName(environmentId: string, name: string) {
    const device = await this.prisma.infraDevice.findUnique({
      where: { environmentId_name: { environmentId, name } },
    });
    if (!device) {
      throw new NotFoundException(`No device named "${name}" in this environment`);
    }
    return device;
  }

  async create(environmentId: string, dto: CreateInfraDeviceDto) {
    const environment = await this.prisma.infraEnvironment.findUnique({ where: { id: environmentId } });
    if (!environment) throw new NotFoundException("Environment not found");

    const existing = await this.prisma.infraDevice.findUnique({
      where: { environmentId_name: { environmentId, name: dto.name } },
    });
    if (existing) throw new ConflictException(`Device "${dto.name}" already exists in this environment`);

    if (dto.parentDeviceId) {
      const parent = await this.prisma.infraDevice.findFirst({
        where: { id: dto.parentDeviceId, environmentId },
        select: { id: true },
      });
      if (!parent) throw new BadRequestException("parentDeviceId must belong to the same environment");
    }

    const device = await this.prisma.infraDevice.create({
      data: { environmentId, ...dto },
      ...WITH_RELATIONS,
    });
    return this.toSummary(device);
  }

  /**
   * `actor` is required (not read off a request in here, since this is
   * also the exact method `AiToolsRegistryService`'s `update_device`
   * handler calls once a human has approved an MCP/chat-proposed edit —
   * logging here, rather than in each caller, is the one place that
   * covers both the direct-browser-edit path and the approved-approval
   * execution path with a single audit record of what actually changed.
   */
  async update(environmentId: string, deviceId: string, actor: string, dto: UpdateInfraDeviceDto) {
    await this.findOrThrow(environmentId, deviceId);
    const device = await this.prisma.infraDevice.update({
      where: { id: deviceId },
      data: dto,
      ...WITH_RELATIONS,
    });
    await this.auditLog.record({
      environmentId,
      actor,
      action: "device.update",
      targetType: "InfraDevice",
      targetId: deviceId,
      outcome: "success",
      detail: { fields: Object.keys(dto) },
    });
    return this.toSummary(device);
  }

  /**
   * The *only* place `enrollmentStatus` ever becomes `ENROLLED` —
   * deliberately not exposed through `UpdateInfraDeviceDto` (so neither
   * a browser PATCH nor an MCP `update_device` call can claim a device
   * is enrolled without one). Called only by
   * `device-onboarding.service.ts`'s `verify()`, and only immediately
   * after a real connector health check actually came back ONLINE —
   * this is what makes `MetricsSchedulerService.pollAllEnrolledDevices`
   * (monitoring/metrics-scheduler.service.ts) start polling this device
   * at all, since it only ever selects `enrollmentStatus: "ENROLLED"`
   * rows. Idempotent: re-verifying an already-enrolled device is a
   * no-op, not a second audit entry.
   */
  async markEnrolled(environmentId: string, deviceId: string, actor: string) {
    const device = await this.findOrThrow(environmentId, deviceId);
    if (device.enrollmentStatus === "ENROLLED") return this.toSummary(device);

    const updated = await this.prisma.infraDevice.update({
      where: { id: deviceId },
      data: { enrollmentStatus: "ENROLLED" },
      ...WITH_RELATIONS,
    });
    await this.auditLog.record({
      environmentId,
      actor,
      action: "device.enrollment-status.enrolled",
      targetType: "InfraDevice",
      targetId: deviceId,
      outcome: "success",
      detail: { previousStatus: device.enrollmentStatus },
    });
    return this.toSummary(updated);
  }

  async remove(environmentId: string, deviceId: string): Promise<void> {
    await this.findOrThrow(environmentId, deviceId);
    await this.prisma.infraDevice.delete({ where: { id: deviceId } });
  }

  /** Dashboard summary (PRODUCT_SPEC.md section 8): counts and
   * aggregate capacity. Memory/storage capacity is a sum of each host's
   * own most recent real reading — never implied to be one shared pool
   * (each host's RAM stays its own RAM; this is only a reporting total). */
  async getDashboardSummary(environmentId: string) {
    const devices = await this.prisma.infraDevice.findMany({ where: { environmentId } });
    const online = devices.filter((d) => d.onlineState === "ONLINE").length;
    const offline = devices.filter((d) => d.onlineState === "OFFLINE").length;
    const unknown = devices.length - online - offline;

    const deviceIds = devices.map((d) => d.id);
    const byteKinds: Prisma.InfraMetricSampleWhereInput["kind"] = {
      in: ["MEMORY_USED_BYTES", "MEMORY_TOTAL_BYTES", "DISK_USED_BYTES", "DISK_TOTAL_BYTES"],
    };
    const recentSamples = deviceIds.length
      ? await this.prisma.infraMetricSample.findMany({
          where: { deviceId: { in: deviceIds }, kind: byteKinds },
          orderBy: { collectedAt: "desc" },
        })
      : [];

    // First sample seen per (device, kind) is the most recent, thanks
    // to the desc ordering above.
    const latestByDeviceKind = new Map<string, number>();
    for (const sample of recentSamples) {
      const key = `${sample.deviceId}:${sample.kind}`;
      if (!latestByDeviceKind.has(key)) latestByDeviceKind.set(key, sample.value);
    }

    let memoryUsedBytes = 0;
    let memoryTotalBytes = 0;
    let storageUsedBytes = 0;
    let storageTotalBytes = 0;
    let hostsReportingMemory = 0;
    let hostsReportingStorage = 0;
    for (const device of devices) {
      const memTotal = latestByDeviceKind.get(`${device.id}:MEMORY_TOTAL_BYTES`);
      if (memTotal) {
        memoryTotalBytes += memTotal;
        memoryUsedBytes += latestByDeviceKind.get(`${device.id}:MEMORY_USED_BYTES`) ?? 0;
        hostsReportingMemory++;
      }
      const diskTotal = latestByDeviceKind.get(`${device.id}:DISK_TOTAL_BYTES`);
      if (diskTotal) {
        storageTotalBytes += diskTotal;
        storageUsedBytes += latestByDeviceKind.get(`${device.id}:DISK_USED_BYTES`) ?? 0;
        hostsReportingStorage++;
      }
    }

    return {
      totalDevices: devices.length,
      onlineDevices: online,
      offlineDevices: offline,
      unknownStateDevices: unknown,
      aggregateMemory: { usedBytes: memoryUsedBytes, totalBytes: memoryTotalBytes, hostsReporting: hostsReportingMemory },
      aggregateStorage: { usedBytes: storageUsedBytes, totalBytes: storageTotalBytes, hostsReporting: hostsReportingStorage },
    };
  }

  private async findOrThrow(environmentId: string, deviceId: string): Promise<InfraDeviceWithRelations> {
    const device = await this.prisma.infraDevice.findFirst({
      where: { id: deviceId, environmentId },
      ...WITH_RELATIONS,
    });
    if (!device) throw new NotFoundException("Device not found");
    return device;
  }

  /** Only lists a capability if the device both claims the protocol
   * (managementProtocols) AND the connector for that protocol actually
   * implements the method — this is the enforcement point for
   * PRODUCT_SPEC.md section 5: "Do not display configuration controls
   * that are not actually implemented." */
  private getCapabilities(device: Pick<InfraDeviceWithRelations, "managementProtocols">) {
    return device.managementProtocols.flatMap((protocol) => {
      const connector = this.connectorRegistry.get(protocol);
      return connector ? connector.getCapabilities().map((capability) => ({ protocol, capability })) : [];
    });
  }

  private toSummary(device: InfraDeviceWithRelations) {
    return {
      id: device.id,
      environmentId: device.environmentId,
      name: device.name,
      category: device.category,
      manufacturer: device.manufacturer,
      model: device.model,
      operatingSystem: device.operatingSystem,
      osVersion: device.osVersion,
      ipAddresses: device.ipAddresses,
      macAddresses: device.macAddresses,
      managementPort: device.managementPort,
      managementProtocols: device.managementProtocols,
      tags: device.tags,
      enrollmentStatus: device.enrollmentStatus,
      onlineState: device.onlineState,
      lastContactAt: device.lastContactAt,
      discoverySource: device.discoverySource,
      discoveredAt: device.discoveredAt,
      updatedAt: device.updatedAt,
      parentDevice: device.parentDevice,
      children: device.children,
    };
  }
}
