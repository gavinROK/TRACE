import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentOrganizationId } from "../auth/current-organization-id.decorator";
import { OrgApiKeyGuard } from "../auth/org-api-key.guard";
import { GetUsageTrendQueryDto } from "./dto/get-usage-trend-query.dto";
import { ReportApiUsageDto } from "./dto/report-api-usage.dto";
import { TelemetryService } from "./telemetry.service";

@Controller("telemetry")
@UseGuards(OrgApiKeyGuard)
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Post("api-usage")
  @HttpCode(201)
  reportApiUsage(
    @CurrentOrganizationId() organizationId: string,
    @Body() dto: ReportApiUsageDto,
  ) {
    return this.telemetry.recordApiUsage(organizationId, dto);
  }

  @Get("summary")
  getSummary(@CurrentOrganizationId() organizationId: string) {
    return this.telemetry.getProviderSummary(organizationId);
  }

  @Get("trend")
  getTrend(
    @CurrentOrganizationId() organizationId: string,
    @Query() query: GetUsageTrendQueryDto,
  ) {
    return this.telemetry.getUsageTrend(organizationId, query.days);
  }
}
