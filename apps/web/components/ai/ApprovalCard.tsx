"use client";

import { useState } from "react";
import type { AiActionClassification } from "@/lib/ai-types";

const CLASSIFICATION_STYLE: Record<AiActionClassification, { label: string; badge: string }> = {
  READ_ONLY: { label: "Read-only", badge: "bg-slate-800 text-slate-300" },
  ADMINISTRATIVE: { label: "Administrative — requires approval", badge: "bg-amber-900/60 text-amber-300" },
  DESTRUCTIVE: { label: "Destructive — requires elevated confirmation", badge: "bg-red-900/60 text-red-300" },
};

interface ApprovalCardProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  classification: AiActionClassification;
  resolved?: { status: "executed" | "rejected"; output?: unknown; isError?: boolean };
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
}

/**
 * PRODUCT_SPEC v0.3 section 5: administrative/destructive tool calls
 * must be explicitly approved, and "the AI must never be able to
 * approve its own pending actions." This card is the only UI that can
 * call the approve/reject endpoints — the model's own chat text never
 * triggers either, it can only narrate what it's waiting on.
 */
export function ApprovalCard({ toolName, toolInput, classification, resolved, onApprove, onReject }: ApprovalCardProps) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const style = CLASSIFICATION_STYLE[classification];

  async function handle(kind: "approve" | "reject") {
    setBusy(kind);
    try {
      await (kind === "approve" ? onApprove() : onReject());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`rounded-md border p-3 text-xs ${classification === "DESTRUCTIVE" ? "border-red-900/60 bg-red-950/30" : "border-amber-900/60 bg-amber-950/20"}`}>
      <div className="flex items-center justify-between">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${style.badge}`}>{style.label}</span>
      </div>
      <p className="mt-2 font-mono text-[11px] text-slate-300">
        {toolName}({Object.entries(toolInput).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})
      </p>

      {resolved ? (
        <p className={`mt-2 text-[11px] ${resolved.status === "rejected" ? "text-slate-500" : resolved.isError ? "text-red-400" : "text-emerald-400"}`}>
          {resolved.status === "rejected" ? "Rejected — not executed." : resolved.isError ? "Executed — failed. See the assistant's response above." : "Executed successfully."}
        </p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => handle("approve")}
            disabled={busy !== null}
            className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy === "approve" ? "Running…" : "Approve & run"}
          </button>
          <button
            onClick={() => handle("reject")}
            disabled={busy !== null}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:text-slate-100 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
