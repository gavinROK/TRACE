import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AiActionClassification } from "@prisma/client";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { ApprovalsService } from "../approvals/approvals.service";
import { MCP_ACTOR, isMcpActor } from "../auth/mcp-actor";
import { CommandExecutionService } from "./command-execution.service";
import { ExecCommandDto, ExecGroupCommandDto } from "./dto/exec-command.dto";

@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/console")
export class ConsoleController {
  constructor(
    @Inject(CommandExecutionService) private readonly commandExecution: CommandExecutionService,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  /**
   * Running an arbitrary shell command is always ADMINISTRATIVE when
   * proposed by an external MCP client (TRACE v0.4) — never executed
   * directly, regardless of how the client's own UI chose to present
   * it to its user, since TRACE cannot verify that presentation
   * happened. A real browser session (a human already looking at
   * TRACE's own UI, authenticated to it directly) is unaffected: this
   * only checks `req.actor`, which TraceAccessGuard sets to
   * "claude-mcp" for exactly one thing — a request bearing
   * TRACE_MCP_SERVICE_TOKEN — and never for a session cookie.
   */
  @Post("exec")
  async exec(@Req() req: InfraAuthenticatedRequest, @Param("environmentId") environmentId: string, @Body() dto: ExecCommandDto) {
    if (isMcpActor(req.actor)) {
      return this.proposeForApproval(environmentId, "execute_command", { deviceName: dto.deviceName, command: dto.command, timeoutMs: dto.timeoutMs }, AiActionClassification.ADMINISTRATIVE);
    }
    return this.commandExecution.executeOnDevice(environmentId, req.actor, dto.deviceName, dto.command, dto.timeoutMs);
  }

  @Post("exec-group")
  async execGroup(@Req() req: InfraAuthenticatedRequest, @Param("environmentId") environmentId: string, @Body() dto: ExecGroupCommandDto) {
    if (isMcpActor(req.actor)) {
      return this.proposeForApproval(
        environmentId,
        "execute_group_command",
        { deviceNames: dto.deviceNames, command: dto.command, timeoutMs: dto.timeoutMs },
        AiActionClassification.ADMINISTRATIVE,
      );
    }
    if (dto.deviceNames.length > 1 && !dto.confirm) {
      throw new BadRequestException(
        `Running a command against ${dto.deviceNames.length} devices requires confirm: true`,
      );
    }
    return this.commandExecution.executeOnGroup(
      environmentId,
      req.actor,
      dto.deviceNames,
      dto.command,
      dto.timeoutMs,
      dto.concurrency,
    );
  }

  /** Shared by exec/exec-group — creates the same `AiPendingAction` row
   * (and thus appears in the same approval queue, approved through the
   * same endpoint) the native chat assistant uses, so a human sees and
   * decides every agent-proposed action in one place regardless of
   * which AI surface proposed it. */
  private proposeForApproval(
    environmentId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    classification: AiActionClassification,
  ) {
    return this.approvals
      .create({ environmentId, toolName, toolInput, classification, requestedBy: MCP_ACTOR })
      .then((pending) => ({
        pending: true as const,
        pendingActionId: pending.id,
        classification,
        message: `This ${classification === AiActionClassification.DESTRUCTIVE ? "destructive" : "administrative"} action requires human approval in TRACE's dashboard (Settings → Pending approvals) before it will run. It has NOT been executed.`,
      }));
  }

  @Get("runs")
  listRuns(@Param("environmentId") environmentId: string, @Query("limit") limit?: string) {
    return this.commandExecution.listRuns(environmentId, limit ? Number(limit) : undefined);
  }

  @Get("runs/:runId")
  getRun(@Param("environmentId") environmentId: string, @Param("runId") runId: string) {
    return this.commandExecution.getRun(environmentId, runId);
  }

  @Post("runs/:runId/cancel")
  async cancel(@Param("runId") runId: string) {
    const cancelled = await this.commandExecution.cancel(runId);
    return { cancelled };
  }
}
