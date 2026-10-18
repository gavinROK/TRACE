"use client";

import { useEffect, useState } from "react";
import type { BackendStatus } from "@/app/api/backend-status/route";

/**
 * Purely a connectivity indicator — it never changes what the graph
 * renders. The graph keeps reading apps/web/lib/data.ts either way; this
 * only proves (or disproves) that the real backend is reachable.
 */
export function BackendStatusBadge() {
  const [status, setStatus] = useState<BackendStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/backend-status")
      .then((response) => response.json() as Promise<BackendStatus>)
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setStatus({ connected: false, reason: "request failed" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  return (
    <span
      data-testid="backend-status-badge"
      title={status.connected ? undefined : status.reason}
      className={`ml-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        status.connected
          ? "border-emerald-800 bg-emerald-950/50 text-emerald-400"
          : "border-slate-700 bg-slate-900 text-slate-500"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${status.connected ? "bg-emerald-400" : "bg-slate-500"}`}
      />
      {status.connected
        ? `Backend connected — ${status.organizationName} (${status.developerCount} developers)`
        : "Backend offline — showing local demo data"}
    </span>
  );
}
