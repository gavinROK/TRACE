/**
 * Every AI provider (Anthropic today; OpenAI/local models reserved for
 * later, see ai.module.ts) implements this one interface. The chat
 * orchestrator (ai-chat.service.ts) and the tool-execution loop never
 * import an SDK type directly — only this contract — so adding a second
 * provider never touches the control-plane code that calls it.
 */
export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema, provider-agnostic — each provider adapts it to its own
   * tool-definition wire format. */
  inputSchema: Record<string, unknown>;
}

export type AiMessageContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface AiProviderMessage {
  role: "user" | "assistant";
  content: AiMessageContent[];
}

export interface AiStreamTextDelta {
  type: "text_delta";
  text: string;
}

export interface AiStreamToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AiStreamUsage {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
}

export interface AiStreamStop {
  type: "message_stop";
  /** Why generation stopped — "tool_use" means the caller must run the
   * tools and send another request with their results; "end_turn"/
   * "max_tokens"/"stop_sequence" mean the turn is finished. */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";
}

export interface AiStreamError {
  type: "error";
  message: string;
  /** True for a transient condition (rate limit, timeout, 5xx) the
   * caller may retry; false for something retrying won't fix (bad API
   * key, invalid request). */
  retryable: boolean;
}

export type AiStreamEvent = AiStreamTextDelta | AiStreamToolUse | AiStreamUsage | AiStreamStop | AiStreamError;

export interface AiModelInfo {
  id: string;
  displayName: string;
  /** Only present for models this provider's maintained pricing table
   * covers — absent (not zero) means cost is genuinely unknown for that
   * model, which callers must render as "unknown," never as free. */
  pricePerMillionInputTokens?: number;
  pricePerMillionOutputTokens?: number;
}

export interface AiSendMessageParams {
  apiKey: string;
  model: string;
  system: string;
  messages: AiProviderMessage[];
  tools: AiToolDefinition[];
  signal?: AbortSignal;
}

export interface AiProvider {
  readonly kind: "ANTHROPIC" | "OPENAI" | "LOCAL";

  /** Live model list from the provider's API when reachable; callers
   * should fall back to a maintained static list on failure (see
   * anthropic-models.ts) rather than block the user on a network call. */
  listModels(apiKey: string): Promise<AiModelInfo[]>;

  /** Streams one assistant turn. Tool-use blocks are yielded whole (not
   * token-by-token) once the provider finishes assembling their input —
   * the orchestrator never sees partial JSON. */
  streamMessage(params: AiSendMessageParams): AsyncIterable<AiStreamEvent>;
}
