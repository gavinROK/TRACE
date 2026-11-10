import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { DiagnosticsService } from "./diagnostics.service";
import { RunDiagnosticDto } from "./dto/run-diagnostic.dto";

/**
 * Deliberately has no `isMcpActor` branch anywhere in this controller —
 * every diagnostic in the catalog is read-only by construction (see
 * connector.types.ts's `DiagnosticName`), so unlike
 * ActionsController/ConsoleController/InfraDevicesController's `update`,
 * an MCP actor's call here runs immediately, the same as
 * `check-health`/`scan` do elsewhere in the infra API.
 */
@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/devices/:deviceId/diagnostics")
export class DiagnosticsController {
  constructor(@Inject(DiagnosticsService) private readonly diagnostics: DiagnosticsService) {}

  @Get()
  listSupported(@Param("environmentId") environmentId: string, @Param("deviceId") deviceId: string) {
    return this.diagnostics.listSupported(environmentId, deviceId);
  }

  @Post()
  run(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("deviceId") deviceId: string,
    @Body() dto: RunDiagnosticDto,
  ) {
    return this.diagnostics.run(environmentId, deviceId, req.actor, dto.name, dto.params);
  }
}
