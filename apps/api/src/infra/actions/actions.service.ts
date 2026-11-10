import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { ConnectorRegistryService } from "../connectors/connector-registry.service";
import { CredentialsService } from "../credentials/credentials.service";
import type { ActionResult } from "../connectors/connector.types";
import { withManagementPort } from "../connectors/apply-management-port";

/** Actions that disrupt a running workload — PRODUCT_SPEC.md section 12:
 * these need an explicit `confirm: true`, not just a valid session. A
 * plain `start` is left out: it can't disrupt anything that's already
 * stopped. */
const DESTRUCTIVE_ACTIONS = new Set(["stop", "shutdown", "reboot"]);

@Injectable()
export class ActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorRegistry: ConnectorRegistryService,
    private readonly credentialsService: CredentialsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async performAction(
    environmentId: string,
    actor: string,
    deviceId: string,
    action: string,
    params: Record<string, unknown> | undefined,
    confirmed: boolean,
  ): Promise<ActionResult> {
    if (DESTRUCTIVE_ACTIONS.has(action) && !confirmed) {
      await this.auditLog.record({
        environmentId,
        actor,
        action: `device.action.${action}`,
        targetType: "InfraDevice",
        targetId: deviceId,
        outcome: "denied",
        detail: { reason: "missing confirm:true for a destructive action" },
      });
      throw new ForbiddenException(`"${action}" is destructive and requires confirm: true`);
    }

    const device = await this.prisma.infraDevice.findFirst({ where: { id: deviceId, environmentId } });
    if (!device) throw new NotFoundException("Device not found");

    const host = device.ipAddresses[0];
    if (!host) throw new BadRequestException(`Device "${device.name}" has no IP address recorded`);

    // Proxmox is the only connector implementing performAction today —
    // iterate the device's claimed protocols rather than hard-coding it,
    // so a future connector with performAction needs no change here.
    for (const protocol of device.managementProtocols) {
      const connector = this.connectorRegistry.get(protocol);
      if (!connector?.performAction) continue;
      const credential = await this.credentialsService.getDecryptedForDevice(environmentId, deviceId, protocol);
      if (!credential) continue;

      const metadata = device.notes ? this.tryParseJson(device.notes) : undefined;
      const result = await connector.performAction(
        { deviceId, host, metadata, credential: withManagementPort(credential, device.managementPort) },
        action,
        params,
      );

      await this.auditLog.record({
        environmentId,
        actor,
        action: `device.action.${action}`,
        targetType: "InfraDevice",
        targetId: deviceId,
        outcome: result.success ? "success" : "error",
        detail: { protocol, params, detail: result.detail },
      });
      return result;
    }

    throw new BadRequestException(`No enrolled protocol on "${device.name}" supports performing actions`);
  }

  private tryParseJson(value: string): Record<string, unknown> | undefined {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}
