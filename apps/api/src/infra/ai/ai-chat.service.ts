import { Inject, Injectable, Logger } from "@nestjs/common";
import { AiActionClassification, AiMessageRole, AiProviderKind } from "@prisma/client";
import { ApprovalsService } from "../approvals/approvals.service";
import { AiConversationsService } from "./ai-conversations.service";
import { AiSettingsService } from "./ai-settings.service";
import { AI_TOOL_DEFINITIONS, AiToolsRegistryService, classifyToolCall, UNSUPPORTED_CAPABILITIES_NOTE } from "./ai-tools.registry";
import { AnthropicProviderService } from "./providers/anthropic-provider.service";
import { findFallbackModelPricing } from "./providers/anthropic-models";
import type { AiMessageContent, AiProviderMessage } from "./providers/ai-provider.interface";
import { redactSecrets, redactSecretsDeep } from "../secret-redaction";

const MAX_TOOL_ITERATIONS = 6;

export type AiChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: unknown; isError: boolean }
  | { type: "pending_approval"; id: string; pendingActionId: string; toolName: string; toolInput: Record<string, unknown>; classification: AiActionClassification }
  | { type: "usage"; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null; model: string }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done"; messageId: string | null };

export interface SendMessageParams {
  environmentId: string;
  actor: string;
  conversationId: string;
  userMessage: string;
  deviceContextId?: string;
  deviceContextName?: string;
  signal?: AbortSignal;
}

/**
 * The orchestrator: builds the system prompt, runs the Anthropic
 * tool-use loop, gates ADMINISTRATIVE/DESTRUCTIVE calls behind
 * ApprovalsService, persists every turn, and yields UI-facing events
 * for the controller to stream as SSE. This is the only place that
 * combines a provider with the tool registry — neither the provider nor
 * the registry knows the other exists.
 */
@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    @Inject(AiSettingsService) private readonly settings: AiSettingsService,
    @Inject(AnthropicProviderService) private readonly provider: AnthropicProviderService,
    @Inject(AiConversationsService) private readonly conversations: AiConversationsService,
    @Inject(AiToolsRegistryService) private readonly tools: AiToolsRegistryService,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AiChatStreamEvent> {
    const apiKey = await this.settings.getApiKey(AiProviderKind.ANTHROPIC);
    if (!apiKey) {
      yield {
        type: "error",
        retryable: false,
        message:
          "No Anthropic API key is configured yet. Open Settings → AI Assistant to add your own Anthropic API key — TRACE never ships with one, and your Claude subscription (if you have one) is separate from API access. See https://console.anthropic.com/settings/keys to create a key.",
      };
      yield { type: "done", messageId: null };
      return;
    }

    const model = await this.settings.getSelectedModelOrDefault(AiProviderKind.ANTHROPIC);

    await this.conversations.appendMessage(params.conversationId, {
      role: AiMessageRole.USER,
      content: params.userMessage,
    });
    await this.conversations.setTitleIfUnset(params.conversationId, params.userMessage);

    const conversation = await this.conversations.getWithMessages(params.environmentId, params.actor, params.conversationId);
    const deviceContextId = params.deviceContextId ?? conversation.deviceContextId ?? undefined;
    const deviceContextName = params.deviceContextName ?? conversation.deviceContextName ?? undefined;

    const system = buildSystemPrompt({ environmentId: params.environmentId, deviceContextId, deviceContextName });
    const providerMessages: AiProviderMessage[] = historyToProviderMessages(conversation.messages);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText = "";
    let finishedCleanly = false;
    const allToolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
    const allToolResults: { id: string; name: string; output: unknown; isError: boolean }[] = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      if (params.signal?.aborted) break;

      let turnText = "";
      const toolUses: { id: string; name: string; input: Record<string, unknown> }[] = [];
      let stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error" = "end_turn";
      let sawError = false;

      try {
        for await (const event of this.provider.streamMessage({ apiKey, model, system, messages: providerMessages, tools: AI_TOOL_DEFINITIONS, signal: params.signal })) {
          if (event.type === "text_delta") {
            turnText += event.text;
            yield { type: "text", text: event.text };
          } else if (event.type === "tool_use") {
            toolUses.push({ id: event.id, name: event.name, input: event.input });
          } else if (event.type === "usage") {
            totalInputTokens += event.inputTokens;
            totalOutputTokens += event.outputTokens;
          } else if (event.type === "message_stop") {
            stopReason = event.stopReason;
          } else if (event.type === "error") {
            sawError = true;
            yield { type: "error", message: event.message, retryable: event.retryable };
          }
        }
      } catch (error) {
        sawError = true;
        yield { type: "error", message: error instanceof Error ? error.message : "Unknown error", retryable: false };
      }

      finalText += turnText;
      if (sawError) break;

      const assistantContent: AiMessageContent[] = [];
      if (turnText) assistantContent.push({ type: "text", text: turnText });
      for (const use of toolUses) assistantContent.push({ type: "tool_use", id: use.id, name: use.name, input: use.input });
      providerMessages.push({ role: "assistant", content: assistantContent });

      if (stopReason !== "tool_use" || toolUses.length === 0) {
        finishedCleanly = true;
        break;
      }

      const toolResultContent: AiMessageContent[] = [];
      for (const use of toolUses) {
        yield { type: "tool_call", id: use.id, name: use.name, input: use.input };
        allToolCalls.push(use);
        const classification = classifyToolCall(use.name, use.input);

        if (classification === AiActionClassification.READ_ONLY) {
          const outcome = await this.runToolSafely(use.name, use.input, { environmentId: params.environmentId, actor: params.actor });
          yield { type: "tool_result", id: use.id, name: use.name, output: outcome.output, isError: outcome.isError };
          allToolResults.push({ id: use.id, name: use.name, output: outcome.output, isError: outcome.isError });
          toolResultContent.push({ type: "tool_result", toolUseId: use.id, content: redactSecrets(JSON.stringify(outcome.output)), isError: outcome.isError });
        } else {
          const pending = await this.approvals.create({
            conversationId: params.conversationId,
            environmentId: params.environmentId,
            toolName: use.name,
            toolInput: use.input,
            classification,
            requestedBy: params.actor,
          });
          yield { type: "pending_approval", id: use.id, pendingActionId: pending.id, toolName: use.name, toolInput: use.input, classification };
          allToolResults.push({ id: use.id, name: use.name, output: { pendingActionId: pending.id, status: "awaiting_approval" }, isError: false });
          toolResultContent.push({
            toolUseId: use.id,
            type: "tool_result",
            content: `Awaiting explicit user approval (pendingActionId: ${pending.id}). Do not assume this action has run or succeeded — tell the user it is waiting for their approval in the UI.`,
          });
        }
      }
      providerMessages.push({ role: "user", content: toolResultContent });
    }

    const estimatedCostUsd = estimateCost(model, totalInputTokens, totalOutputTokens);
    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      yield { type: "usage", inputTokens: totalInputTokens, outputTokens: totalOutputTokens, estimatedCostUsd, model };
    }

    const saved = finishedCleanly || finalText || allToolCalls.length > 0
      ? await this.conversations.appendMessage(params.conversationId, {
          role: AiMessageRole.ASSISTANT,
          content: finalText || "(no response text — see tool results below)",
          model,
          inputTokens: totalInputTokens || undefined,
          outputTokens: totalOutputTokens || undefined,
          estimatedCostUsd: estimatedCostUsd ?? undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          toolResults: allToolResults.length > 0 ? redactSecretsDeep(allToolResults) : undefined,
        })
      : null;

    yield { type: "done", messageId: saved?.id ?? null };
  }

  /**
   * Runs an already-approved ADMINISTRATIVE/DESTRUCTIVE tool call and
   * records what happened. Called only from AiController's
   * approve/reject endpoints — never from inside the model's own turn
   * (see approvals/approvals.service.ts's header comment for why that split is
   * what actually enforces "the AI cannot approve its own action").
   *
   * Known scope cut, stated plainly rather than overclaimed: this does
   * not resume the paused Anthropic tool-use turn to let the model
   * narrate the result in its own next sentence — the conversation's
   * provider-message history for that turn ended when the stream
   * yielded `pending_approval` and the HTTP request completed. The
   * result is executed, fully audited, and persisted as its own TOOL
   * message instead; the UI renders it as a result card. Asking a
   * follow-up question in the same conversation works normally and the
   * model can call get_device/check_device_health etc. to see the
   * aftermath for itself.
   */
  async resolveApproval(environmentId: string, pendingActionId: string, decidedBy: string, approve: boolean) {
    const decision = await this.approvals.decide(environmentId, pendingActionId, decidedBy, approve);
    // conversationId is null for a pending action an external MCP
    // client proposed (TRACE v0.4) — there's no chat thread to append a
    // TOOL-role record to in that case; ApprovalsService's own audit
    // log entry (written inside `decide`) is the record for that path.
    if (!approve) {
      if (decision.conversationId) {
        await this.conversations.appendMessage(decision.conversationId, {
          role: AiMessageRole.TOOL,
          content: `Rejected: ${decision.toolName}`,
          toolCalls: [{ name: decision.toolName, input: decision.toolInput }],
        });
      }
      return { status: "rejected" as const };
    }

    const outcome = await this.runToolSafely(decision.toolName, decision.toolInput, { environmentId, actor: decidedBy });
    await this.approvals.recordResult(pendingActionId, outcome);
    if (decision.conversationId) {
      await this.conversations.appendMessage(decision.conversationId, {
        role: AiMessageRole.TOOL,
        content: `Executed: ${decision.toolName}`,
        toolCalls: [{ name: decision.toolName, input: decision.toolInput }],
        toolResults: [{ name: decision.toolName, output: outcome.output, isError: outcome.isError }],
      });
    }
    return { status: "executed" as const, output: outcome.output, isError: outcome.isError };
  }

  private async runToolSafely(
    name: string,
    input: Record<string, unknown>,
    ctx: { environmentId: string; actor: string },
  ): Promise<{ output: unknown; isError: boolean }> {
    try {
      const result = await this.tools.run(name, input, ctx);
      return { output: redactSecretsDeep(result), isError: false };
    } catch (error) {
      this.logger.warn(`Tool "${name}" failed: ${error instanceof Error ? error.message : error}`);
      return { output: { error: error instanceof Error ? error.message : "Tool execution failed" }, isError: true };
    }
  }
}

function buildSystemPrompt(ctx: { environmentId: string; deviceContextId?: string; deviceContextName?: string }): string {
  const lines = [
    "You are the native AI assistant built into TRACE, an infrastructure management platform. You help the operator understand and manage their own real infrastructure through natural language.",
    "",
    "Hard rules:",
    "- Use tools to retrieve real data. Never invent device state, metrics, topology, or command output. If a tool doesn't give you what you need, say so plainly instead of guessing.",
    "- Distinguish observed facts (from a tool result) from your own hypotheses/recommendations — label hypotheses as such.",
    "- Administrative and destructive tool calls (execute_command, execute_group_command, perform_action, update_device, request_credential_enrollment) require the user's explicit approval in the UI before they run. Proposing one does not run it — never tell the user an action succeeded until you see its actual tool result after approval.",
    "- request_credential_enrollment never carries, and must never be given, the actual secret — it only opens a 5-minute window after a human approves it, during which they type the credential directly into TRACE's own device panel. If asked to enroll a credential, call this tool and explain that the user will enter the value themselves once they approve it; never ask the user to paste a password, key, or token into this chat.",
    "- For a request that would modify infrastructure (e.g. \"restart the Beelink\", \"show me offline devices and fix them\"), explain what you're about to do before calling the tool, so the approval card the user sees makes sense.",
    "",
    UNSUPPORTED_CAPABILITIES_NOTE,
    "",
    `Current environment id: ${ctx.environmentId}.`,
  ];
  if (ctx.deviceContextId) {
    lines.push(
      `The user currently has a device selected in the UI: "${ctx.deviceContextName ?? ctx.deviceContextId}" (id: ${ctx.deviceContextId}). When they ask about "it", "this device", or don't name a device, assume they mean this one — call get_device with this id rather than asking which device they mean, unless context clearly indicates a different device.`,
    );
  }
  return lines.join("\n");
}

function historyToProviderMessages(
  messages: { role: AiMessageRole; content: string }[],
): AiProviderMessage[] {
  // The latest user message was already persisted by the caller before
  // this read (see sendMessage above), so re-deriving providerMessages
  // from persisted history — rather than keeping a separate in-memory
  // copy — means a reloaded page's next message always starts from
  // exactly what's in the database.
  //
  // TOOL-role rows are a persisted record of what happened, not
  // replayed into the provider: each turn's own tool loop sends its
  // tool_use/tool_result pairs within that same turn's provider call
  // sequence (see sendMessage above). Replaying old tool_use blocks
  // across turns without their original tool_result pairing would
  // violate Anthropic's required tool_use/tool_result adjacency rule.
  const result: AiProviderMessage[] = [];
  for (const m of messages) {
    if (m.role === AiMessageRole.USER) {
      result.push({ role: "user", content: [{ type: "text", text: m.content }] });
    } else if (m.role === AiMessageRole.ASSISTANT) {
      result.push({ role: "assistant", content: [{ type: "text", text: m.content }] });
    }
  }
  return result;
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = findFallbackModelPricing(model);
  if (!pricing?.pricePerMillionInputTokens || !pricing.pricePerMillionOutputTokens) return null;
  return (inputTokens / 1_000_000) * pricing.pricePerMillionInputTokens + (outputTokens / 1_000_000) * pricing.pricePerMillionOutputTokens;
}
