import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuditLogService } from "../audit/audit-log.service";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { CreateInfraDeviceDto } from "./dto/create-device.dto";
import { UpdateInfraDeviceDto } from "./dto/update-device.dto";
import { InfraDevicesService } from "./devices.service";
import { DevicePollingService } from "../monitoring/device-polling.service";

@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/devices")
export class InfraDevicesController {
  constructor(
    private readonly devicesService: InfraDevicesService,
    private readonly devicePollingService: DevicePollingService,
    private readonly auditLog: AuditLogService,
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

  @Patch(":deviceId")
  update(
    @Param("environmentId") environmentId: string,
    @Param("deviceId") deviceId: string,
    @Body() dto: UpdateInfraDeviceDto,
  ) {
    return this.devicesService.update(environmentId, deviceId, dto);
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
