import type { AiConversationDetail, AiConversationSummary, AiModelInfo, AiPendingActionRecord, AiSettingsStatus, AiStreamEvent } from "./ai-types";
import { InfraApiError } from "./infra-api";

const BASE_URL = process.env.NEXT_PUBLIC_TRACE_API_BASE_URL ?? "http://localhost:4000";

async function aiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new InfraApiError(res.status, body.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const aiApi = {
  getSettings: () => aiFetch<AiSettingsStatus>("/infra/ai/settings"),
  listModels: () => aiFetch<AiModelInfo[]>("/infra/ai/settings/models"),
  saveApiKey: (apiKey: string) => aiFetch<AiSettingsStatus>("/infra/ai/settings/api-key", { method: "POST", body: JSON.stringify({ apiKey }) }),
  clearApiKey: () => aiFetch<{ ok: true }>("/infra/ai/settings/api-key", { method: "DELETE" }),
  setModel: (modelId: string) => aiFetch<AiSettingsStatus>("/infra/ai/settings/model", { method: "POST", body: JSON.stringify({ modelId }) }),

  listConversations: (environmentId: string) => aiFetch<AiConversationSummary[]>(`/infra/environments/${environmentId}/ai/conversations`),
  startConversation: (environmentId: string, deviceContextId?: string, deviceContextName?: string) =>
    aiFetch<AiConversationSummary>(`/infra/environments/${environmentId}/ai/conversations`, {
      method: "POST",
      body: JSON.stringify({ deviceContextId, deviceContextName }),
    }),
  getConversation: (environmentId: string, conversationId: string) =>
    aiFetch<AiConversationDetail>(`/infra/environments/${environmentId}/ai/conversations/${conversationId}`),
  renameConversation: (environmentId: string, conversationId: string, title: string) =>
    aiFetch<{ ok: true }>(`/infra/environments/${environmentId}/ai/conversations/${conversationId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (environmentId: string, conversationId: string) =>
    aiFetch<{ ok: true }>(`/infra/environments/${environmentId}/ai/conversations/${conversationId}`, { method: "DELETE" }),
  listPendingActions: (environmentId: string, conversationId: string) =>
    aiFetch<AiPendingActionRecord[]>(`/infra/environments/${environmentId}/ai/conversations/${conversationId}/pending-actions`),
  /** Every pending action in the environment regardless of which AI
   * surface proposed it (the native assistant's own chat turns, or an
   * external MCP client — TRACE v0.4) — the one queue for "approve
   * anything waiting on me." */
  listAllPendingActions: (environmentId: string) =>
    aiFetch<AiPendingActionRecord[]>(`/infra/environments/${environmentId}/ai/pending-actions`),

  approve: (environmentId: string, pendingActionId: string) =>
    aiFetch<{ status: string; output?: unknown; isError?: boolean }>(
      `/infra/environments/${environmentId}/ai/pending-actions/${pendingActionId}/approve`,
      { method: "POST" },
    ),
  reject: (environmentId: string, pendingActionId: string) =>
    aiFetch<{ status: string }>(`/infra/environments/${environmentId}/ai/pending-actions/${pendingActionId}/reject`, { method: "POST" }),

  /**
   * Streams one assistant turn. Parses the backend's `data: <json>\n\n`
   * SSE frames by hand (no EventSource — EventSource can't POST a body,
   * and this needs to send the message text) rather than adding an SSE
   * client dependency for a single endpoint. Pass `signal` to stop
   * generation early — aborting the fetch closes the connection, which
   * the backend's `req.on("close", ...)` handler treats the same as any
   * other disconnect.
   */
  async *sendMessage(
    environmentId: string,
    conversationId: string,
    message: string,
    options?: { deviceContextId?: string; deviceContextName?: string; signal?: AbortSignal },
  ): AsyncGenerator<AiStreamEvent> {
    const res = await fetch(`${BASE_URL}/infra/environments/${environmentId}/ai/conversations/${conversationId}/messages`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, deviceContextId: options?.deviceContextId, deviceContextName: options?.deviceContextName }),
      signal: options?.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new InfraApiError(res.status, body.message ?? res.statusText);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            yield JSON.parse(line.slice("data: ".length)) as AiStreamEvent;
          } catch {
            // A malformed frame shouldn't crash an otherwise-good stream.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};
