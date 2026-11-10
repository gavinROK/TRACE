"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiApi } from "@/lib/ai-api";
import { InfraApiError } from "@/lib/infra-api";
import type {
  AiActionClassification,
  AiConversationSummary,
  AiMessageRecord,
  AiPendingActionRecord,
  AiSettingsStatus,
} from "@/lib/ai-types";
import { MarkdownLite } from "./MarkdownLite";
import { ApprovalCard } from "./ApprovalCard";

interface LiveToolEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "done" | "awaiting_approval";
  output?: unknown;
  isError?: boolean;
  pendingActionId?: string;
  classification?: AiActionClassification;
}

interface AiChatPanelProps {
  environmentId: string;
  selectedDeviceId: string | null;
  selectedDeviceName: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenSettings: () => void;
}

/**
 * The native AI assistant's chat surface — mounted once at Workspace
 * level (not per-view) so it's reachable from Overview/Topology/
 * Devices/Monitoring alike, per PRODUCT_SPEC v0.3 section 2: "The
 * assistant should be accessible from anywhere in the application."
 */
export function AiChatPanel({ environmentId, selectedDeviceId, selectedDeviceName, collapsed, onToggleCollapsed, onOpenSettings }: AiChatPanelProps) {
  const [settings, setSettings] = useState<AiSettingsStatus | null>(null);
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessageRecord[]>([]);
  const [pendingActions, setPendingActions] = useState<AiPendingActionRecord[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveTools, setLiveTools] = useState<LiveToolEvent[]>([]);
  const [liveUsage, setLiveUsage] = useState<{ inputTokens: number; outputTokens: number; estimatedCostUsd: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aiApi.getSettings().then(setSettings).catch(() => undefined);
  }, []);

  const refreshConversationList = useCallback(() => {
    aiApi.listConversations(environmentId).then(setConversations).catch(() => undefined);
  }, [environmentId]);

  useEffect(() => {
    if (!collapsed) refreshConversationList();
  }, [collapsed, refreshConversationList]);

  const loadConversation = useCallback(
    async (id: string) => {
      const [detail, pending] = await Promise.all([aiApi.getConversation(environmentId, id), aiApi.listPendingActions(environmentId, id)]);
      setMessages(detail.messages);
      setPendingActions(pending);
    },
    [environmentId],
  );

  useEffect(() => {
    if (!collapsed) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, liveText, liveTools, collapsed]);

  function startNewChat() {
    setConversationId(null);
    setMessages([]);
    setPendingActions([]);
    setLiveText("");
    setLiveTools([]);
    setLiveUsage(null);
    setError(null);
  }

  async function handleSelectConversation(id: string) {
    setConversationId(id);
    setLiveText("");
    setLiveTools([]);
    setLiveUsage(null);
    setError(null);
    await loadConversation(id);
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setInput("");
    setSending(true);
    setLiveText("");
    setLiveTools([]);
    setLiveUsage(null);

    try {
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const created = await aiApi.startConversation(environmentId, selectedDeviceId ?? undefined, selectedDeviceName ?? undefined);
        activeConversationId = created.id;
        setConversationId(created.id);
      }

      // Optimistic local echo of what the user just typed — the
      // backend persists its own copy; this just avoids a visible gap
      // before the stream's first token arrives.
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, role: "USER", content: text, toolCalls: null, toolResults: null, model: null, inputTokens: null, outputTokens: null, estimatedCostUsd: null, createdAt: new Date().toISOString() },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;

      for await (const event of aiApi.sendMessage(environmentId, activeConversationId, text, {
        deviceContextId: selectedDeviceId ?? undefined,
        deviceContextName: selectedDeviceName ?? undefined,
        signal: controller.signal,
      })) {
        if (event.type === "text") {
          setLiveText((prev) => prev + event.text);
        } else if (event.type === "tool_call") {
          setLiveTools((prev) => [...prev, { id: event.id, name: event.name, input: event.input, status: "running" }]);
        } else if (event.type === "tool_result") {
          setLiveTools((prev) => prev.map((t) => (t.id === event.id ? { ...t, status: "done", output: event.output, isError: event.isError } : t)));
        } else if (event.type === "pending_approval") {
          setLiveTools((prev) => prev.map((t) => (t.id === event.id ? { ...t, status: "awaiting_approval", pendingActionId: event.pendingActionId, classification: event.classification } : t)));
        } else if (event.type === "usage") {
          setLiveUsage({ inputTokens: event.inputTokens, outputTokens: event.outputTokens, estimatedCostUsd: event.estimatedCostUsd });
        } else if (event.type === "error") {
          setError(event.message);
        } else if (event.type === "done") {
          await loadConversation(activeConversationId);
          setLiveText("");
          setLiveTools([]);
          refreshConversationList();
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof InfraApiError ? err.message : err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  async function handleApprove(pendingActionId: string) {
    await aiApi.approve(environmentId, pendingActionId);
    if (conversationId) await loadConversation(conversationId);
  }

  async function handleReject(pendingActionId: string) {
    await aiApi.reject(environmentId, pendingActionId);
    if (conversationId) await loadConversation(conversationId);
  }

  const contextLabel = useMemo(
    () => (selectedDeviceName ? `Context: ${selectedDeviceName}` : "No device selected — ask about anything in this environment"),
    [selectedDeviceName],
  );

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        className="flex h-full w-9 shrink-0 flex-col items-center gap-2 border-l border-slate-800 bg-slate-950 py-3 text-slate-400 hover:text-slate-200"
        aria-label="Open AI assistant"
      >
        <span>✦</span>
        <span className="text-[10px] [writing-mode:vertical-rl]">AI Assistant</span>
      </button>
    );
  }

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-slate-800 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">✦ AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={startNewChat} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-900 hover:text-slate-200">
            New
          </button>
          <HistoryMenu conversations={conversations} activeId={conversationId} onSelect={handleSelectConversation} />
          <button onClick={onToggleCollapsed} className="text-slate-500 hover:text-slate-300" aria-label="Collapse AI assistant">
            ▸
          </button>
        </div>
      </div>

      <div className="border-b border-slate-800 bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-400">{contextLabel}</div>

      {!settings?.configured ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-slate-300">No Anthropic API key configured yet.</p>
          <p className="text-xs text-slate-500">
            TRACE never ships with one and your Claude subscription doesn&apos;t include API access — add your own key in Settings to enable the
            assistant.
          </p>
          <button onClick={onOpenSettings} className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500">
            Open Settings
          </button>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 && liveText === "" && liveTools.length === 0 && (
              <p className="text-xs text-slate-500">
                Ask about your infrastructure — e.g. &quot;Show me all offline devices&quot; or &quot;What&apos;s consuming the most memory on{" "}
                {selectedDeviceName ?? "my Beelink"}?&quot;
              </p>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} pendingActions={pendingActions} onApprove={handleApprove} onReject={handleReject} />
            ))}
            {(liveText || liveTools.length > 0) && (
              <div className="space-y-2">
                {liveTools.map((tool) => (
                  <ToolIndicator key={tool.id} tool={tool} onApprove={handleApprove} onReject={handleReject} />
                ))}
                {liveText && (
                  <div className="rounded-lg bg-slate-900 px-3 py-2">
                    <MarkdownLite content={liveText} />
                  </div>
                )}
              </div>
            )}
            {liveUsage && (
              <p className="text-right text-[10px] text-slate-600">
                {liveUsage.inputTokens + liveUsage.outputTokens} tokens
                {liveUsage.estimatedCostUsd != null ? ` · ~$${liveUsage.estimatedCostUsd.toFixed(4)}` : ""}
              </p>
            )}
            {error && <p className="rounded-md border border-red-900/60 bg-red-950/30 p-2 text-xs text-red-400">{error}</p>}
          </div>

          <form onSubmit={handleSend} className="flex gap-2 border-t border-slate-800 p-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e);
                }
              }}
              placeholder="Ask about your infrastructure…"
              rows={2}
              disabled={sending}
              className="flex-1 resize-none rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-500 disabled:opacity-60"
            />
            {sending ? (
              <button type="button" onClick={handleStop} className="self-end rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600">
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} className="self-end rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50">
                Send
              </button>
            )}
          </form>
        </>
      )}
    </aside>
  );
}

function HistoryMenu({ conversations, activeId, onSelect }: { conversations: AiConversationSummary[]; activeId: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-900 hover:text-slate-200">
        History
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 max-h-72 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl">
          {conversations.length === 0 && <p className="p-2 text-[11px] text-slate-500">No conversations yet.</p>}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c.id);
                setOpen(false);
              }}
              className={`block w-full rounded px-2 py-1.5 text-left text-[11px] ${c.id === activeId ? "bg-sky-600/20 text-sky-300" : "text-slate-300 hover:bg-slate-800"}`}
            >
              <div className="truncate">{c.title ?? "Untitled conversation"}</div>
              <div className="text-[10px] text-slate-500">
                {c.deviceContextName ? `${c.deviceContextName} · ` : ""}
                {c._count.messages} messages
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  pendingActions,
  onApprove,
  onReject,
}: {
  message: AiMessageRecord;
  pendingActions: AiPendingActionRecord[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  if (message.role === "USER") {
    return (
      <div className="ml-6 rounded-lg bg-sky-600/20 px-3 py-2 text-sm text-slate-100">{message.content}</div>
    );
  }

  if (message.role === "TOOL") {
    const result = message.toolResults?.[0];
    return (
      <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-400">
        {message.content}
        {result && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-slate-500">{truncate(JSON.stringify(result.output, null, 2))}</pre>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message.toolCalls?.map((call, i) => {
        const pending = pendingActions.find((p) => p.toolName === call.name && JSON.stringify(p.toolInput) === JSON.stringify(call.input));
        const result = message.toolResults?.[i];
        if (pending && pending.status === "PENDING") {
          return (
            <ApprovalCard
              key={call.id ?? i}
              toolName={call.name}
              toolInput={call.input}
              classification={pending.classification}
              onApprove={() => onApprove(pending.id)}
              onReject={() => onReject(pending.id)}
            />
          );
        }
        return (
          <div key={call.id ?? i} className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-400">
            <span className="font-mono text-slate-300">{call.name}</span>
            {result && (
              <span className={result.isError ? "ml-2 text-red-400" : "ml-2 text-emerald-400"}>{result.isError ? "failed" : "ok"}</span>
            )}
          </div>
        );
      })}
      {message.content && (
        <div className="rounded-lg bg-slate-900 px-3 py-2">
          <MarkdownLite content={message.content} />
        </div>
      )}
      {(message.inputTokens || message.outputTokens) && (
        <p className="text-right text-[10px] text-slate-600">
          {message.model} · {(message.inputTokens ?? 0) + (message.outputTokens ?? 0)} tokens
          {message.estimatedCostUsd != null ? ` · ~$${message.estimatedCostUsd.toFixed(4)}` : ""}
        </p>
      )}
    </div>
  );
}

function ToolIndicator({ tool, onApprove, onReject }: { tool: LiveToolEvent; onApprove: (id: string) => Promise<void>; onReject: (id: string) => Promise<void> }) {
  if (tool.status === "awaiting_approval" && tool.pendingActionId && tool.classification) {
    return (
      <ApprovalCard
        toolName={tool.name}
        toolInput={tool.input}
        classification={tool.classification}
        onApprove={() => onApprove(tool.pendingActionId!)}
        onReject={() => onReject(tool.pendingActionId!)}
      />
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-400">
      {tool.status === "running" ? (
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
      ) : (
        <span className={`inline-block h-2 w-2 rounded-full ${tool.isError ? "bg-red-400" : "bg-emerald-400"}`} />
      )}
      <span className="font-mono text-slate-300">{tool.name}</span>
      <span className="text-slate-500">{tool.status === "running" ? "running…" : tool.isError ? "failed" : "done"}</span>
    </div>
  );
}

function truncate(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
