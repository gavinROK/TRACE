import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AiActionClassification, AiPendingActionStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { isMcpActor } from "../auth/mcp-actor";
import { redactSecretsDeep } from "../secret-redaction";

/**
 * Owns `AiPendingAction` — the hard enforcement point for "an AI
 * surface must never be able to approve its own pending action"
 * (originally PRODUCT_SPEC v0.3 section 5 for the native chat
 * assistant; TRACE v0.4 extends the same guarantee to an external MCP
 * client). That guarantee is structural, not a prompt instruction or a
 * client-side convention:
 *
 * - `create` is called from two places only: the native assistant's
 *   own tool-call loop (`ai/ai-chat.service.ts`, conversationId set),
 *   and the MCP-actor gate in `ConsoleController`/`ActionsController`
 *   (conversationId null, requestedBy "claude-mcp"). Neither caller
 *   has any code path from there to `decide`.
 * - `decide` is called from exactly one place: `AiController`'s POST
 *   `.../ai/pending-actions/:id/(approve|reject)` endpoint, which
 *   requires a real authenticated HTTP request through
 *   `TraceAccessGuard` — and that guard only ever assigns the
 *   `claude-mcp` actor from a request carrying the MCP bearer token,
 *   never from a request this service or an AI tool-call loop
 *   generates itself. `decide` additionally refuses a
 *   `claude-mcp`-prefixed `decidedBy` outright, as defense in depth
 *   against a future caller accidentally wiring that path.
 *
 * In short: an agent (native or MCP) can only ever *propose* a gated
 * action; only a real browser-session HTTP request can approve one.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(params: {
    conversationId?: string;
    environmentId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    classification: AiActionClassification;
    requestedBy: string;
  }) {
    const pending = await this.prisma.aiPendingAction.create({
      data: {
        conversationId: params.conversationId,
        environmentId: params.environmentId,
        toolName: params.toolName,
        toolInput: redactSecretsDeep(params.toolInput) as never,
        classification: params.classification,
        requestedBy: params.requestedBy,
      },
    });
    await this.auditLog.record({
      environmentId: params.environmentId,
      actor: params.requestedBy,
      action: `ai.tool.${params.toolName}.proposed`,
      targetType: "AiPendingAction",
      targetId: pending.id,
      outcome: "success",
      detail: { classification: params.classification, source: params.conversationId ? "chat" : "mcp" },
    });
    return pending;
  }

  async get(environmentId: string, pendingActionId: string) {
    const pending = await this.prisma.aiPendingAction.findFirst({ where: { id: pendingActionId, environmentId } });
    if (!pending) throw new NotFoundException("Pending action not found");
    return pending;
  }

  async listPendingForConversation(conversationId: string) {
    return this.prisma.aiPendingAction.findMany({
      where: { conversationId, status: AiPendingActionStatus.PENDING },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Every pending action in the environment regardless of source
   * (native chat conversation, or an external MCP client) — the single
   * place a human can go to see and decide everything waiting on them,
   * per TRACE v0.4's requirement that both AI surfaces share one
   * consistent approval queue rather than two separate ones. */
  async listPendingForEnvironment(environmentId: string) {
    return this.prisma.aiPendingAction.findMany({
      where: { environmentId, status: AiPendingActionStatus.PENDING },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * `decidedBy` must be a browser-session actor (`user:<id>`) — never
   * the MCP service-token actor and never anything an AI surface's own
   * turn could produce, since this method is reachable only from
   * AiController's dedicated approve/reject HTTP endpoints.
   */
  async decide(
    environmentId: string,
    pendingActionId: string,
    decidedBy: string,
    approve: boolean,
  ): Promise<{ toolName: string; toolInput: Record<string, unknown>; conversationId: string | null }> {
    const pending = await this.get(environmentId, pendingActionId);
    if (pending.status !== AiPendingActionStatus.PENDING) {
      throw new BadRequestException(`This action was already ${pending.status.toLowerCase()}`);
    }
    if (isMcpActor(decidedBy)) {
      // Defense in depth: neither the AI chat endpoints nor an MCP
      // request ever authenticate as a decider anyway (see
      // ai.controller.ts's guard usage), but an explicit refusal here
      // means this invariant survives even if a future route
      // accidentally allowed it.
      throw new ForbiddenException("An AI/service identity cannot approve its own pending action");
    }

    await this.prisma.aiPendingAction.update({
      where: { id: pendingActionId },
      data: {
        status: approve ? AiPendingActionStatus.APPROVED : AiPendingActionStatus.REJECTED,
        decidedBy,
        decidedAt: new Date(),
      },
    });
    await this.auditLog.record({
      environmentId,
      actor: decidedBy,
      action: `ai.tool.${pending.toolName}.${approve ? "approved" : "rejected"}`,
      targetType: "AiPendingAction",
      targetId: pending.id,
      outcome: "success",
      detail: { classification: pending.classification },
    });

    return {
      toolName: pending.toolName,
      toolInput: pending.toolInput as Record<string, unknown>,
      conversationId: pending.conversationId,
    };
  }

  async recordResult(pendingActionId: string, result: unknown): Promise<void> {
    await this.prisma.aiPendingAction.update({
      where: { id: pendingActionId },
      data: { resultJson: redactSecretsDeep(result) as never },
    });
  }
}
