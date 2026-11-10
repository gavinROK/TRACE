import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AiActionClassification } from "@prisma/client";
import { AuditLogService } from "../audit/audit-log.service";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { MCP_ACTOR, isMcpActor } from "../auth/mcp-actor";
import { ApprovalsService } from "../approvals/approvals.service";
import { CreateInfraDeviceDto } from "./dto/create-device.dto";
import { UpdateInfraDeviceDto } from "./dto/update-device.dto";
import { InfraDevicesService } from "./devices.service";
import { DevicePollingService } from "../monitoring/device-polling.service";

@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/devices")
export class InfraDevicesController {
  constructor(
    @Inject(InfraDevicesService) private readonly devicesService: InfraDevicesService,
    @Inject(DevicePollingService) private readonly devicePollingService: DevicePollingService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  @Get()
  list(@Param("environmentId") environmentId: string) {
    return this.devicesService.list(environmentId);
  }

  @Get("summary")
  summary(@Param("environmentId") environmentId: string) {
    return this.devicesService.getDashboardSummary(environmentId);
  }

  @Get(":deviceId")
  get(@Param("environmentId") environmentId: string, @Param("deviceId") deviceId: string) {
    return this.devicesService.get(environmentId, deviceId);
  }

  @Post()
  async create(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Body() dto: CreateInfraDeviceDto,
  ) {
    const device = await this.devicesService.create(environmentId, dto);
    await this.auditLog.record({
      environmentId,
      actor: req.actor,
      action: "device.create",
      targetType: "InfraDevice",
      targetId: device.id,
      outcome: "success",
      detail: { name: device.name, category: device.category },
    });
    return device;
  }

  /**
   * An external MCP client's `update_device` call never writes directly
   * — same `isMcpActor` gate as `ActionsController.perform`/
   * `ConsoleController.exec` (see docs/ARCHITECTURE.md "MCP
   * integration"), and the same ADMINISTRATIVE classification the
   * native assistant's tool registry already uses for this tool
   * (`ai-tools.registry.ts`). A real browser session editing a device
   * directly in TRACE's own UI is unaffected.
   */
  @Patch(":deviceId")
  async update(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("deviceId") deviceId: string,
    @Body() dto: UpdateInfraDeviceDto,
  ) {
    if (isMcpActor(req.actor)) {
      const pending = await this.approvals.create({
        environmentId,
        toolName: "update_device",
        toolInput: { deviceId, ...dto },
        classification: AiActionClassification.ADMINISTRATIVE,
        requestedBy: MCP_ACTOR,
      });
      return {
        pending: true as const,
        pendingActionId: pending.id,
        classification: AiActionClassification.ADMINISTRATIVE,
        message: "This administrative action requires human approval in TRACE's dashboard (Settings → Pending approvals) before it will run. It has NOT been executed.",
      };
    }
    return this.devicesService.update(environmentId, deviceId, req.actor, dto);
  }

  @Delete(":deviceId")
  async remove(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("deviceId") deviceId: string,
  ) {
    await this.devicesService.remove(environmentId, deviceId);
    await this.auditLog.record({
      environmentId,
      actor: req.actor,
      action: "device.delete",
      targetType: "InfraDevice",
      targetId: deviceId,
      outcome: "success",
    });
    return { ok: true };
  }

  @Post(":deviceId/check-health")
  async checkHealth(@Param("environmentId") environmentId: string, @Param("deviceId") deviceId: string) {
    return this.devicePollingService.pollDevice(environmentId, deviceId);
  }
}
