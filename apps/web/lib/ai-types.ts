export type AiMessageRole = "USER" | "ASSISTANT" | "TOOL";
export type AiActionClassification = "READ_ONLY" | "ADMINISTRATIVE" | "DESTRUCTIVE";

export interface AiSettingsStatus {
  configured: boolean;
  provider: "ANTHROPIC" | "OPENAI" | "LOCAL";
  selectedModel: string | null;
  updatedAt: string | null;
}

export interface AiModelInfo {
  id: string;
  displayName: string;
  pricePerMillionInputTokens?: number;
  pricePerMillionOutputTokens?: number;
}

export interface AiConversationSummary {
  id: string;
  title: string | null;
  deviceContextId: string | null;
  deviceContextName: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

export interface AiMessageRecord {
  id: string;
  role: AiMessageRole;
  content: string;
  toolCalls: { id?: string; name: string; input: Record<string, unknown> }[] | null;
  toolResults: { id?: string; name: string; output: unknown; isError: boolean }[] | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  createdAt: string;
}

export interface AiConversationDetail extends AiConversationSummary {
  messages: AiMessageRecord[];
}

export interface AiPendingActionRecord {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  classification: AiActionClassification;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  createdAt: string;
}

/** Mirrors apps/api/src/infra/ai/ai-chat.service.ts's AiChatStreamEvent —
 * kept in sync by hand since the SSE wire format has no shared-types
 * package between frontend and backend (same as the rest of lib/infra-types.ts). */
export type AiStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: unknown; isError: boolean }
  | { type: "pending_approval"; id: string; pendingActionId: string; toolName: string; toolInput: Record<string, unknown>; classification: AiActionClassification }
  | { type: "usage"; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null; model: string }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done"; messageId: string | null };
