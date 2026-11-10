import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AiActionClassification } from "@prisma/client";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { ApprovalsService } from "../approvals/approvals.service";
import { MCP_ACTOR, isMcpActor } from "../auth/mcp-actor";
import { ActionsService, DESTRUCTIVE_ACTIONS } from "./actions.service";
import { PerformActionDto } from "./dto/perform-action.dto";

@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/devices/:deviceId/actions")
export class ActionsController {
  constructor(
    private readonly actionsService: ActionsService,
    private readonly approvals: ApprovalsService,
  ) {}

  /**
   * An external MCP client proposing `stop`/`shutdown`/`reboot`
   * (DESTRUCTIVE_ACTIONS — same set ActionsService itself uses to
   * decide when confirm:true is required) or `start`
   * (ADMINISTRATIVE) never executes it directly — TRACE v0.4 routes
   * every agent-proposed action through the same `AiPendingAction`
   * queue and approval endpoint the native assistant uses, regardless
   * of what `confirm` the client sent. A real browser session is
   * unaffected and keeps the existing confirm:true behavior exactly as
   * before.
   */
  @Post()
  async perform(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("deviceId") deviceId: string,
    @Body() dto: PerformActionDto,
  ) {
    if (isMcpActor(req.actor)) {
      const classification = DESTRUCTIVE_ACTIONS.has(dto.action) ? AiActionClassification.DESTRUCTIVE : AiActionClassification.ADMINISTRATIVE;
      const pending = await this.approvals.create({
        environmentId,
        toolName: "perform_action",
        toolInput: { deviceId, action: dto.action, params: dto.params },
        classification,
        requestedBy: MCP_ACTOR,
      });
      return {
        pending: true as const,
        pendingActionId: pending.id,
        classification,
        message: `This ${classification === AiActionClassification.DESTRUCTIVE ? "destructive" : "administrative"} action requires human approval in TRACE's dashboard (Settings → Pending approvals) before it will run. It has NOT been executed.`,
      };
    }
    return this.actionsService.performAction(environmentId, req.actor, deviceId, dto.action, dto.params, dto.confirm ?? false);
  }
}
