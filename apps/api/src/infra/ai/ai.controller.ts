import { Body, Controller, Delete, ForbiddenException, Get, Inject, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AiProviderKind } from "@prisma/client";
import type { Response } from "express";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { isMcpActor } from "../auth/mcp-actor";
import { ApprovalsService } from "../approvals/approvals.service";
import { AiChatService } from "./ai-chat.service";
import { AiConversationsService } from "./ai-conversations.service";
import { AiSettingsService } from "./ai-settings.service";
import { RenameConversationDto, SaveApiKeyDto, SendMessageDto, SetModelDto, StartConversationDto } from "./dto/ai.dto";

/**
 * A separate consumer of TRACE's existing services, parallel to (never
 * layered on top of) packages/mcp-server — PRODUCT_SPEC v0.3 section 1:
 * "Do not duplicate the MCP server." The MCP bridge's service-token
 * actor is explicitly refused everywhere here: this subsystem is for
 * the browser session that's using TRACE directly, not for Claude Code.
 */
@UseGuards(TraceAccessGuard, ThrottlerGuard)
@Controller("infra")
export class AiController {
  constructor(
    @Inject(AiSettingsService) private readonly settings: AiSettingsService,
    @Inject(AiChatService) private readonly chat: AiChatService,
    @Inject(AiConversationsService) private readonly conversations: AiConversationsService,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  @Get("ai/settings")
  async getSettings(@Req() req: InfraAuthenticatedRequest) {
    assertBrowserActor(req);
    return this.settings.getStatus(AiProviderKind.ANTHROPIC);
  }

  @Get("ai/settings/models")
  async listModels(@Req() req: InfraAuthenticatedRequest) {
    assertBrowserActor(req);
    return this.settings.listAvailableModels(AiProviderKind.ANTHROPIC);
  }

  @Post("ai/settings/api-key")
  async saveApiKey(@Req() req: InfraAuthenticatedRequest, @Body() dto: SaveApiKeyDto) {
    assertBrowserActor(req);
    return this.settings.saveApiKey(AiProviderKind.ANTHROPIC, dto.apiKey);
  }

  @Delete("ai/settings/api-key")
  async clearApiKey(@Req() req: InfraAuthenticatedRequest) {
    assertBrowserActor(req);
    await this.settings.clearApiKey(AiProviderKind.ANTHROPIC);
    return { ok: true };
  }

  @Post("ai/settings/model")
  async setModel(@Req() req: InfraAuthenticatedRequest, @Body() dto: SetModelDto) {
    assertBrowserActor(req);
    return this.settings.setSelectedModel(AiProviderKind.ANTHROPIC, dto.modelId);
  }

  @Post("environments/:environmentId/ai/conversations")
  async startConversation(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Body() dto: StartConversationDto,
  ) {
    assertBrowserActor(req);
    return this.conversations.start({ environmentId, actor: req.actor, ...dto });
  }

  @Get("environments/:environmentId/ai/conversations")
  async listConversations(@Req() req: InfraAuthenticatedRequest, @Param("environmentId") environmentId: string) {
    assertBrowserActor(req);
    return this.conversations.list(environmentId, req.actor);
  }

  @Get("environments/:environmentId/ai/conversations/:conversationId")
  async getConversation(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("conversationId") conversationId: string,
  ) {
    assertBrowserActor(req);
    return this.conversations.getWithMessages(environmentId, req.actor, conversationId);
  }

  @Patch("environments/:environmentId/ai/conversations/:conversationId")
  async renameConversation(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("conversationId") conversationId: string,
    @Body() dto: RenameConversationDto,
  ) {
    assertBrowserActor(req);
    await this.conversations.rename(environmentId, req.actor, conversationId, dto.title);
    return { ok: true };
  }

  @Get("environments/:environmentId/ai/conversations/:conversationId/pending-actions")
  async listPendingActions(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("conversationId") conversationId: string,
  ) {
    assertBrowserActor(req);
    await this.conversations.assertOwned(environmentId, req.actor, conversationId);
    return this.approvals.listPendingForConversation(conversationId);
  }

  /**
   * Every pending action in the environment, from either AI surface —
   * the one queue a human checks to find and decide an MCP client's
   * proposed action, which (unlike a chat message) has no conversation
   * to be "inside" of. See docs/ARCHITECTURE.md's "MCP integration"
   * section.
   */
  @Get("environments/:environmentId/ai/pending-actions")
  async listAllPendingActions(@Req() req: InfraAuthenticatedRequest, @Param("environmentId") environmentId: string) {
    assertBrowserActor(req);
    return this.approvals.listPendingForEnvironment(environmentId);
  }

  /**
   * Deliberately NOT gated by `assertBrowserActor` — unlike every other
   * route in this controller, an MCP client is allowed to call this
   * one, because it is read-only and tells it nothing it couldn't
   * already see elsewhere (its own proposed tool name/input, and
   * whether a human has acted on it yet). This is how an external MCP
   * client checks whether its own proposed action has been approved —
   * it cannot approve it (see the approve/reject endpoints above, both
   * still browser-only), only ask "is it done yet?".
   */
  @Get("environments/:environmentId/ai/pending-actions/:pendingActionId")
  async getPendingAction(@Param("environmentId") environmentId: string, @Param("pendingActionId") pendingActionId: string) {
    return this.approvals.get(environmentId, pendingActionId);
  }

  @Delete("environments/:environmentId/ai/conversations/:conversationId")
  async deleteConversation(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("conversationId") conversationId: string,
  ) {
    assertBrowserActor(req);
    await this.conversations.remove(environmentId, req.actor, conversationId);
    return { ok: true };
  }

  /**
   * Server-Sent Events. Rate-limited (not globally — only this endpoint
   * actually spends API budget) per PRODUCT_SPEC v0.3 section 10's
   * "Rate limiting" requirement: 12 requests/minute per IP is generous
   * for interactive chat while still bounding runaway cost from a
   * stuck client retry loop.
   */
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post("environments/:environmentId/ai/conversations/:conversationId/messages")
  async sendMessage(
    @Req() req: InfraAuthenticatedRequest,
    @Res() res: Response,
    @Param("environmentId") environmentId: string,
    @Param("conversationId") conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    assertBrowserActor(req);
    await this.conversations.assertOwned(environmentId, req.actor, conversationId);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const abortController = new AbortController();
    req.on("close", () => abortController.abort());

    try {
      for await (const event of this.chat.sendMessage({
        environmentId,
        actor: req.actor,
        conversationId,
        userMessage: dto.message,
        deviceContextId: dto.deviceContextId,
        deviceContextName: dto.deviceContextName,
        signal: abortController.signal,
      })) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Unknown error", retryable: false })}\n\n`);
    } finally {
      res.end();
    }
  }

  /**
   * The only way an ADMINISTRATIVE/DESTRUCTIVE tool call this assistant
   * proposed can ever actually run — see approvals/approvals.service.ts and
   * ai-chat.service.ts's resolveApproval. `assertBrowserActor` above
   * already excludes the MCP service token; ApprovalsService.decide
   * additionally refuses a "claude-mcp"-prefixed decider as defense in
   * depth, so this invariant holds even if this controller changes.
   */
  @Post("environments/:environmentId/ai/pending-actions/:pendingActionId/approve")
  async approve(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("pendingActionId") pendingActionId: string,
  ) {
    assertBrowserActor(req);
    return this.chat.resolveApproval(environmentId, pendingActionId, req.actor, true);
  }

  @Post("environments/:environmentId/ai/pending-actions/:pendingActionId/reject")
  async reject(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("pendingActionId") pendingActionId: string,
  ) {
    assertBrowserActor(req);
    return this.chat.resolveApproval(environmentId, pendingActionId, req.actor, false);
  }
}

/** The MCP service token is a different, intentionally separate
 * integration surface (packages/mcp-server) — PRODUCT_SPEC v0.3
 * section 1 says not to duplicate or layer on top of it. Every method
 * in this controller calls this first so that invariant holds even if
 * a route is added here later without remembering to check. */
function assertBrowserActor(req: InfraAuthenticatedRequest): void {
  if (isMcpActor(req.actor)) {
    throw new ForbiddenException("The native AI assistant is a browser-session feature — the MCP service token cannot use it.");
  }
}
