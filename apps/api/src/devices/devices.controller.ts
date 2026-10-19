import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentOrganizationId } from "../auth/current-organization-id.decorator";
import { OrgApiKeyGuard } from "../auth/org-api-key.guard";
import { DevicesService } from "./devices.service";
import { AddSoftwareDto } from "./dto/add-software.dto";
import { EnrollDeviceDto } from "./dto/enroll-device.dto";

@Controller("devices")
@UseGuards(OrgApiKeyGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list(@CurrentOrganizationId() organizationId: string) {
    return this.devices.listDevices(organizationId);
  }

  @Post()
  enroll(@CurrentOrganizationId() organizationId: string, @Body() dto: EnrollDeviceDto) {
    return this.devices.enrollDevice(organizationId, dto);
  }

  @Post(":id/software")
  addSoftware(
    @CurrentOrganizationId() organizationId: string,
    @Param("id") deviceId: string,
    @Body() dto: AddSoftwareDto,
  ) {
    return this.devices.addSoftware(organizationId, deviceId, dto);
  }
}
