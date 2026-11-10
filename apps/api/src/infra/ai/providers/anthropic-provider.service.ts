import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import type {
  AiModelInfo,
  AiProvider,
  AiSendMessageParams,
  AiStreamEvent,
} from "./ai-provider.interface";
import { ANTHROPIC_FALLBACK_MODELS, findFallbackModelPricing } from "./anthropic-models";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const MAX_TOKENS = 4096;

/**
 * The only file in this repo that imports `@anthropic-ai/sdk` directly.
 * Everything else (ai-chat.service.ts, the tool registry) talks to the
 * `AiProvider` interface, so swapping or adding a provider never touches
 * orchestration code — see providers/ai-provider.interface.ts.
 *
 * Retries and timeouts are the SDK's own built-in handling
 * (`maxRetries`/`timeout` client options below), not hand-rolled — the
 * SDK already retries on 429/5xx/timeouts with backoff.
 */
@Injectable()
export class AnthropicProviderService implements AiProvider {
  readonly kind = "ANTHROPIC" as const;
  private readonly logger = new Logger(AnthropicProviderService.name);

  async listModels(apiKey: string): Promise<AiModelInfo[]> {
    try {
      const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES });
      const page = await client.models.list({ limit: 50 });
      const models: AiModelInfo[] = [];
      for await (const model of page) {
        const pricing = findFallbackModelPricing(model.id);
        models.push({
          id: model.id,
          displayName: model.display_name ?? model.id,
          pricePerMillionInputTokens: pricing?.pricePerMillionInputTokens,
          pricePerMillionOutputTokens: pricing?.pricePerMillionOutputTokens,
        });
      }
      return models.length > 0 ? models : ANTHROPIC_FALLBACK_MODELS;
    } catch (error) {
      this.logger.warn(
        `Live Anthropic model list unavailable (${error instanceof Error ? error.message : "unknown error"}) — falling back to the maintained list.`,
      );
      return ANTHROPIC_FALLBACK_MODELS;
    }
  }

  async *streamMessage(params: AiSendMessageParams): AsyncIterable<AiStreamEvent> {
    const client = new Anthropic({
      apiKey: params.apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    });

    const anthropicMessages: Anthropic.MessageParam[] = params.messages.map((m) => ({
      role: m.role,
      content: m.content.map((block) => {
        if (block.type === "text") return { type: "text" as const, text: block.text };
        if (block.type === "tool_use") {
          return { type: "tool_use" as const, id: block.id, name: block.name, input: block.input };
        }
        return {
          type: "tool_result" as const,
          tool_use_id: block.toolUseId,
          content: block.content,
          is_error: block.isError,
        };
      }),
    }));

    const tools: Anthropic.Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    let stream: ReturnType<typeof client.messages.stream>;
    try {
      stream = client.messages.stream(
        {
          model: params.model,
          max_tokens: MAX_TOKENS,
          system: params.system,
          messages: anthropicMessages,
          tools,
        },
        { signal: params.signal },
      );
    } catch (error) {
      yield toErrorEvent(error);
      return;
    }

    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();
      for (const block of final.content) {
        if (block.type === "tool_use") {
          yield { type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> };
        }
      }
      yield {
        type: "usage",
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      };
      yield {
        type: "message_stop",
        stopReason: toStopReason(final.stop_reason),
      };
    } catch (error) {
      yield toErrorEvent(error);
    }
  }
}

function toStopReason(reason: string | null): "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error" {
  if (reason === "tool_use" || reason === "max_tokens" || reason === "stop_sequence" || reason === "end_turn") {
    return reason;
  }
  return "end_turn";
}

function toErrorEvent(error: unknown): AiStreamEvent {
  if (error instanceof Anthropic.APIError) {
    const retryable = error.status === 429 || error.status === undefined || error.status >= 500;
    return { type: "error", message: error.message, retryable };
  }
  const message = error instanceof Error ? error.message : "Unknown error contacting Anthropic";
  return { type: "error", message, retryable: false };
}
