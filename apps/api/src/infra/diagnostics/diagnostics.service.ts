import { BadGatewayException, BadRequestException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { ConnectorRegistryService } from "../connectors/connector-registry.service";
import { withManagementPort } from "../connectors/apply-management-port";
import type { DiagnosticName, DiagnosticResult } from "../connectors/connector.types";
import { CredentialsService } from "../credentials/credentials.service";
import { DIAGNOSTIC_NAMES } from "./dto/run-diagnostic.dto";

/**
 * Runs one of the fixed, read-only diagnostics from connector.types.ts
 * against a device — never approval-gated (PRODUCT_SPEC-style
 * invariant: every name in the catalog is non-mutating by construction,
 * same reasoning as `check_device_health`/`scan_network`). Mirrors the
 * device/protocol/credential resolution `ActionsService`/
 * `DevicePollingService` already use rather than introducing a third,
 * different lookup strategy.
 */
@Injectable()
export class DiagnosticsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConnectorRegistryService) private readonly connectorRegistry: ConnectorRegistryService,
    @Inject(CredentialsService) private readonly credentialsService: CredentialsService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  async run(environmentId: string, deviceId: string, actor: string, name: DiagnosticName, params?: Record<string, unknown>): Promise<DiagnosticResult> {
    const device = await this.prisma.infraDevice.findFirst({ where: { id: deviceId, environmentId } });
    if (!device) throw new NotFoundException("Device not found");

    const host = device.ipAddresses[0];
    if (!host) throw new BadRequestException(`Device "${device.name}" has no IP address recorded`);

    for (const protocol of device.managementProtocols) {
      const connector = this.connectorRegistry.get(protocol);
      if (!connector?.runDiagnostic) continue;
      const credential = await this.credentialsService.getDecryptedForDevice(environmentId, deviceId, protocol);
      if (!credential) continue;

      try {
        const result = await connector.runDiagnostic(
          { deviceId, host, credential: withManagementPort(credential, device.managementPort) },
          name,
          params,
        );
        await this.auditLog.record({
          environmentId,
          actor,
          action: `device.diagnostic.${name}`,
          targetType: "InfraDevice",
          targetId: deviceId,
          outcome: "success",
          detail: { protocol, params },
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await this.auditLog.record({
          environmentId,
          actor,
          action: `device.diagnostic.${name}`,
          targetType: "InfraDevice",
          targetId: deviceId,
          outcome: "error",
          detail: { protocol, params, error: message },
        });
        // A validation error (e.g. requireSafeIdentifier's rejection)
        // is already a proper NestJS HttpException — preserve its real
        // status (400) instead of flattening everything to 500. Any
        // other failure (connection refused, auth failure, timeout) is
        // the upstream device, not TRACE itself, failing — 502 reports
        // that honestly rather than looking like a TRACE bug. Live
        // testing against an unreachable port is what surfaced this: it
        // previously came back as an opaque "Internal server error."
        throw error instanceof HttpException ? error : new BadGatewayException(message);
      }
    }

    throw new BadRequestException(`No enrolled protocol on "${device.name}" supports diagnostics. Target SSH (InfraManagementProtocol.SSH) with an SSH credential.`);
  }

  /** Answers "what can I even ask for" on this specific device, so a
   * caller never guesses at a diagnostic name that will 400 — every
   * connector that declares the `runDiagnostic` capability is assumed
   * to support the full fixed catalog (true for SSH today; a future
   * connector with a narrower set would need this to branch by
   * protocol, same as `buildTarget`-style helpers elsewhere). */
  async listSupported(environmentId: string, deviceId: string): Promise<DiagnosticName[]> {
    const device = await this.prisma.infraDevice.findFirst({ where: { id: deviceId, environmentId } });
    if (!device) throw new NotFoundException("Device not found");
    const supported = device.managementProtocols.some((protocol) => this.connectorRegistry.get(protocol)?.getCapabilities().includes("runDiagnostic"));
    return supported ? DIAGNOSTIC_NAMES : [];
  }
}
