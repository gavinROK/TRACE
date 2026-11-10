"use client";

import { useCallback, useEffect, useState } from "react";
import { aiApi } from "@/lib/ai-api";
import type { AiPendingActionRecord } from "@/lib/ai-types";
import { ApprovalCard } from "./ApprovalCard";

interface PendingApprovalsPanelProps {
  environmentId: string;
}

/**
 * The one approval queue for every agent-proposed action regardless of
 * which AI surface proposed it — the native chat assistant's own tool
 * calls (which also show inline in the chat panel) and, as of TRACE
 * v0.4, an external MCP client's calls (trace_execute_command,
 * trace_execute_group_command, trace_perform_action), which have no
 * chat conversation to show a card inside. Reuses ApprovalCard and the
 * exact same approve/reject endpoints the chat panel uses — no second
 * approval UI or backend path.
 */
export function PendingApprovalsPanel({ environmentId }: PendingApprovalsPanelProps) {
  const [pending, setPending] = useState<AiPendingActionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    aiApi
      .listAllPendingActions(environmentId)
      .then(setPending)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load pending approvals"));
  }, [environmentId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleApprove(id: string) {
    await aiApi.approve(environmentId, id);
    load();
  }

  async function handleReject(id: string) {
    await aiApi.reject(environmentId, id);
    load();
  }

  if (error) return <p className="text-xs text-red-400">{error}</p>;
  if (!pending) return <p className="text-xs text-slate-500">Loading…</p>;
  if (pending.length === 0) return <p className="text-xs text-slate-500">Nothing waiting on approval right now.</p>;

  return (
    <div className="space-y-2">
      {pending.map((action) => (
        <div key={action.id}>
          <p className="mb-1 text-[10px] text-slate-500">Requested {new Date(action.createdAt).toLocaleString()}</p>
          <ApprovalCard
            toolName={action.toolName}
            toolInput={action.toolInput}
            classification={action.classification}
            onApprove={() => handleApprove(action.id)}
            onReject={() => handleReject(action.id)}
          />
        </div>
      ))}
    </div>
  );
}
