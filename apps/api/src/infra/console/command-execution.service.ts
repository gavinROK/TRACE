import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InfraCommandStatus, InfraManagementProtocol } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { ConnectorRegistryService } from "../connectors/connector-registry.service";
import { CredentialsService } from "../credentials/credentials.service";
import { InfraDevicesService } from "../devices/devices.service";
import { runWithConcurrency } from "./concurrency";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_GROUP_CONCURRENCY = 4;

/**
 * The backend execution engine behind both the frontend's command
 * console and (via the same service) the MCP server's
 * trace_execute_command/trace_execute_group_command tools — one engine,
 * one audit trail, no matter which caller triggered it
 * (PRODUCT_SPEC.md section 11: "Do not build independent duplicate
 * management implementations"). Every run is persisted as an
 * InfraCommandRun before it starts, so a crash mid-command still leaves
 * a RUNNING row for the operator to find, not a silently lost command.
 */
@Injectable()
export class CommandExecutionService {
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorRegistry: ConnectorRegistryService,
    private readonly credentialsService: CredentialsService,
    private readonly devicesService: InfraDevicesService,
    private readonly auditLog: AuditLogService,
  ) {}

  async executeOnDevice(environmentId: string, actor: string, deviceName: string, command: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    // resolveByName throws NotFoundException for an unknown name, and the
    // schema's (environmentId, name) unique index guarantees this can
    // never resolve to more than one device — see devices.service.ts.
    const device = await this.devicesService.resolveByName(environmentId, deviceName);

    const run = await this.prisma.infraCommandRun.create({
      data: {
        environmentId,
        deviceId: device.id,
        targetLabel: device.name,
        command,
        status: InfraCommandStatus.RUNNING,
        requestedBy: actor,
        startedAt: new Date(),
        timeoutMs,
      },
    });

    const controller = new AbortController();
    this.abortControllers.set(run.id, controller);

    try {
      const host = device.ipAddresses[0];
      if (!host) throw new BadRequestException(`Device "${device.name}" has no IP address recorded`);

      const credential = await this.credentialsService.getDecryptedForDevice(environmentId, device.id, InfraManagementProtocol.SSH);
      if (!credential) throw new BadRequestException(`No SSH credential enrolled for device "${device.name}"`);

      const connector = this.connectorRegistry.require(InfraManagementProtocol.SSH);
      if (!connector.executeCommand) throw new BadRequestException("SSH connector does not support command execution");

      const result = await connector.executeCommand(
        { deviceId: device.id, host, credential },
        command,
        { timeoutMs, signal: controller.signal },
      );

      const status = result.cancelled
        ? InfraCommandStatus.CANCELLED
        : result.timedOut
          ? InfraCommandStatus.TIMED_OUT
          : result.exitCode === 0
            ? InfraCommandStatus.SUCCEEDED
            : InfraCommandStatus.FAILED;

      const updated = await this.prisma.infraCommandRun.update({
        where: { id: run.id },
        data: { status, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, finishedAt: new Date() },
      });

      await this.auditLog.record({
        environmentId,
        actor,
        action: "console.exec",
        targetType: "InfraDevice",
        targetId: device.id,
        outcome: status === InfraCommandStatus.SUCCEEDED ? "success" : "error",
        detail: { command, status, runId: run.id },
      });

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const updated = await this.prisma.infraCommandRun.update({
        where: { id: run.id },
        data: { status: InfraCommandStatus.FAILED, stderr: message, finishedAt: new Date() },
      });
      await this.auditLog.record({
        environmentId,
        actor,
        action: "console.exec",
        targetType: "InfraDevice",
        targetId: device.id,
        outcome: "error",
        detail: { command, error: message, runId: run.id },
      });
      return updated;
    } finally {
      this.abortControllers.delete(run.id);
    }
  }

  async executeOnGroup(
    environmentId: string,
    actor: string,
    deviceNames: string[],
    command: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    concurrency = DEFAULT_GROUP_CONCURRENCY,
  ) {
    // One device name failing to resolve (typo, wrong environment) must
    // never abort the rest of the batch — unlike the single-device
    // executeOnDevice, which throws so a single bad name 404s cleanly.
    return runWithConcurrency(deviceNames, concurrency, async (deviceName) => {
      try {
        return await this.executeOnDevice(environmentId, actor, deviceName, command, timeoutMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await this.auditLog.record({
          environmentId,
          actor,
          action: "console.exec",
          targetType: "InfraDevice",
          outcome: "error",
          detail: { command, deviceName, error: message },
        });
        return {
          id: null,
          environmentId,
          deviceId: null,
          targetLabel: deviceName,
          command,
          status: InfraCommandStatus.FAILED,
          exitCode: null,
          stdout: null,
          stderr: message,
          requestedBy: actor,
          startedAt: null,
          finishedAt: new Date(),
          timeoutMs,
          createdAt: new Date(),
        };
      }
    });
  }

  async cancel(runId: string): Promise<boolean> {
    const controller = this.abortControllers.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async getRun(environmentId: string, runId: string) {
    const run = await this.prisma.infraCommandRun.findFirst({ where: { id: runId, environmentId } });
    if (!run) throw new NotFoundException("Command run not found");
    return run;
  }

  async listRuns(environmentId: string, limit = 100) {
    return this.prisma.infraCommandRun.findMany({
      where: { environmentId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
