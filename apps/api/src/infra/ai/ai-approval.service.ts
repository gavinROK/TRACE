import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AiActionClassification, AiPendingActionStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { redactSecretsDeep } from "./secret-redaction";

/**
 * Owns AiPendingAction — the hard enforcement point for PRODUCT_SPEC
 * v0.3 section 5: "The AI must never be able to approve its own
 * pending actions." That guarantee is structural, not a prompt
 * instruction: `create` is only ever called from inside the tool-call
 * loop in ai-chat.service.ts (model output can request a tool call, but
 * nothing in that loop ever calls `decide`); `decide` is only ever
 * called from AiController's POST
 * .../ai/pending-actions/:id/(approve|reject) endpoint, which requires
 * a real authenticated HTTP request through TraceAccessGuard. The
 * model's own text output has no code path that reaches `decide` — it
 * is a different method on a different call stack, reachable only via
 * a browser session actor.
 */
@Injectable()
export class AiApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(params: {
    conversationId: string;
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
      detail: { classification: params.classification },
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

  /**
   * `decidedBy` must be a browser-session actor (`user:<id>`) — never
   * the MCP service-token actor and never anything the assistant's own
   * turn could produce, since this method is reachable only from
   * AiController's dedicated approve/reject HTTP endpoints.
   */
  async decide(
    environmentId: string,
    pendingActionId: string,
    decidedBy: string,
    approve: boolean,
  ): Promise<{ toolName: string; toolInput: Record<string, unknown>; conversationId: string }> {
    const pending = await this.get(environmentId, pendingActionId);
    if (pending.status !== AiPendingActionStatus.PENDING) {
      throw new BadRequestException(`This action was already ${pending.status.toLowerCase()}`);
    }
    if (decidedBy.startsWith("claude-mcp")) {
      // Defense in depth: the AI chat endpoints never authenticate as
      // this actor anyway (see ai.controller.ts's guard usage), but an
      // explicit refusal here means this invariant survives even if a
      // future route accidentally allowed it.
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
