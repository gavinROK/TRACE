import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AlertStatus } from "@prisma/client";
import { CurrentOrganizationId } from "../auth/current-organization-id.decorator";
import { OrgApiKeyGuard } from "../auth/org-api-key.guard";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateAlertStatusDto } from "./dto/update-alert-status.dto";
import { SecurityDetectionService } from "./security-detection.service";

@Controller("security/alerts")
@UseGuards(OrgApiKeyGuard)
export class SecurityAlertsController {
  constructor(
    private readonly detection: SecurityDetectionService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@CurrentOrganizationId() organizationId: string, @Query("status") status?: AlertStatus) {
    return this.detection.listAlerts(organizationId, status);
  }

  /**
   * Manually triggers a detection run. There is no scheduler yet (see
   * docs/DEVELOPMENT_STATUS.md) — this exists so the rules are usable and
   * demonstrable today rather than waiting on infrastructure that doesn't
   * exist yet.
   */
  @Post("run")
  run(@CurrentOrganizationId() organizationId: string) {
    return this.detection.runDetection(organizationId);
  }

  @Patch(":id/status")
  async updateStatus(
    @CurrentOrganizationId() organizationId: string,
    @Param("id") id: string,
    @Body() dto: UpdateAlertStatusDto,
  ) {
    const existing = await this.prisma.securityAlert.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException("Security alert not found");
    }

    return this.prisma.securityAlert.update({
      where: { id },
      data: { status: dto.status },
    });
  }
}
