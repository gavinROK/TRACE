import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InfraManagementProtocol, InfraOnlineState } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { ConnectorRegistryService } from "../connectors/connector-registry.service";
import { CredentialsService } from "../credentials/credentials.service";
import type { ConnectorTarget } from "../connectors/connector.types";
import { withManagementPort } from "../connectors/apply-management-port";

export interface PollResult {
  onlineState: InfraOnlineState;
  checkedAt: Date;
  detail?: string;
  metricsCollected: number;
}

/**
 * The one place that actually calls a connector's getHealth/getMetrics
 * against a real device — used both by the on-demand "check health"
 * button (InfraDevicesController) and the scheduled poller
 * (metrics-scheduler.service.ts), so both paths produce identical,
 * real (never fabricated) readings. A device with no usable
 * protocol/credential combination is reported UNKNOWN, not silently
 * skipped as if it were healthy.
 */
@Injectable()
export class DevicePollingService {
  private readonly logger = new Logger(DevicePollingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConnectorRegistryService) private readonly connectorRegistry: ConnectorRegistryService,
    @Inject(CredentialsService) private readonly credentialsService: CredentialsService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  async pollDevice(environmentId: string, deviceId: string): Promise<PollResult> {
    const device = await this.prisma.infraDevice.findFirst({ where: { id: deviceId, environmentId } });
    if (!device) throw new NotFoundException("Device not found");

    const target = await this.buildTarget(environmentId, device);
    if (!target) {
      return { onlineState: InfraOnlineState.UNKNOWN, checkedAt: new Date(), detail: "No usable protocol/credential/IP for this device", metricsCollected: 0 };
    }

    const connector = this.connectorRegistry.require(target.protocol);
    const health = await connector.getHealth(target.connectorTarget);

    if (health.newlyPinnedHostKeyFingerprint) {
      await this.credentialsService.recordHostKeyFingerprint(environmentId, deviceId, target.protocol, health.newlyPinnedHostKeyFingerprint);
    }

    await this.prisma.infraDevice.update({
      where: { id: deviceId },
      data: { onlineState: health.onlineState, lastContactAt: health.onlineState === "ONLINE" ? health.checkedAt : device.lastContactAt },
    });

    let metricsCollected = 0;
    if (health.onlineState === "ONLINE" && connector.getMetrics) {
      try {
        const readings = await connector.getMetrics(target.connectorTarget);
        if (readings.length > 0) {
          await this.prisma.infraMetricSample.createMany({
            data: readings.map((r) => ({ deviceId, kind: r.kind, label: r.label, value: r.value, unit: r.unit, collectedAt: r.collectedAt })),
          });
          metricsCollected = readings.length;
        }
      } catch (error) {
        this.logger.warn(`getMetrics failed for device ${deviceId}: ${error instanceof Error ? error.message : error}`);
      }
    }

    await this.auditLog.record({
      environmentId,
      actor: "system:poller",
      action: "device.health-check",
      targetType: "InfraDevice",
      targetId: deviceId,
      outcome: "success",
      detail: { onlineState: health.onlineState, metricsCollected },
    });

    return { onlineState: health.onlineState, checkedAt: health.checkedAt, detail: health.detail, metricsCollected };
  }

  private async buildTarget(
    environmentId: string,
    device: { id: string; ipAddresses: string[]; managementProtocols: InfraManagementProtocol[]; managementPort: number | null },
  ): Promise<{ protocol: InfraManagementProtocol; connectorTarget: ConnectorTarget } | undefined> {
    const host = device.ipAddresses[0];
    if (!host) return undefined;

    for (const protocol of device.managementProtocols) {
      const connector = this.connectorRegistry.get(protocol);
      if (!connector) continue;
      const credential = await this.credentialsService.getDecryptedForDevice(environmentId, device.id, protocol);
      if (!credential) continue;
      return {
        protocol,
        connectorTarget: { deviceId: device.id, host, credential: withManagementPort(credential, device.managementPort) },
      };
    }
    return undefined;
  }
}
