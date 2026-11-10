import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { ActionsService } from "./actions.service";
import { PerformActionDto } from "./dto/perform-action.dto";

@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/devices/:deviceId/actions")
export class ActionsController {
  constructor(private readonly actionsService: ActionsService) {}

  @Post()
  perform(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("deviceId") deviceId: string,
    @Body() dto: PerformActionDto,
  ) {
    return this.actionsService.performAction(environmentId, req.actor, deviceId, dto.action, dto.params, dto.confirm ?? false);
  }
}
