"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ALERT_STATUSES,
  formatAlertType,
  type AlertStatus,
  type SecurityAlertRecord,
} from "@/lib/security-alert";

interface SecurityAlertsPanelProps {
  onClose: () => void;
  onDataChanged?: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; alerts: SecurityAlertRecord[] };

const SEVERITY_CLASS: Record<string, string> = {
  LOW: "text-slate-400",
  MEDIUM: "text-amber-400",
  HIGH: "text-rose-400",
  CRITICAL: "text-rose-300",
};

export function SecurityAlertsPanel({ onClose, onDataChanged }: SecurityAlertsPanelProps) {
  const [filter, setFilter] = useState<"OPEN" | "ALL">("OPEN");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Deliberately doesn't reset to {status: "loading"} before each fetch —
  // the previous list just stays on screen until the new one arrives
  // (stale-while-revalidate), which also keeps this effect lint-clean
  // (no synchronous setState call reachable from the effect body).
  const load = useCallback(() => {
    const query = filter === "OPEN" ? "?status=OPEN" : "";
    fetch(`/api/trace/security/alerts${query}`)
      .then((res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        return res.json() as Promise<SecurityAlertRecord[]>;
      })
      .then((alerts) => setState({ status: "ready", alerts }))
      .catch((error: unknown) => {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load security alerts",
        });
      });
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (id: string, status: AlertStatus) => {
    setUpdatingId(id);
    try {
      const response = await fetch(`/api/trace/security/alerts/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(`update failed (${response.status})`);
      load();
      onDataChanged?.();
    } catch {
      // The list simply won't reflect the change — a reasonable, visible
      // failure mode without a separate error-toast system.
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <aside
      data-testid="security-alerts-panel"
      className="absolute right-4 top-4 z-10 w-[26rem] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">security alerts</div>
          <h2 className="text-lg font-semibold text-slate-100">Security Alerts</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 flex gap-1.5">
        {(["OPEN", "ALL"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              filter === option
                ? "bg-cyan-500 text-slate-950"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {option === "OPEN" ? "Open" : "All"}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        {state.status === "loading" && <p className="text-sm text-slate-500">Loading alerts…</p>}
        {state.status === "error" && <p className="text-sm text-rose-400">{state.message}</p>}
        {state.status === "ready" && state.alerts.length === 0 && (
          <p className="text-sm text-slate-500">No alerts.</p>
        )}
        {state.status === "ready" &&
          state.alerts.map((alert) => (
            <div
              key={alert.id}
              data-testid={`security-alert-${alert.id}`}
              className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-semibold ${SEVERITY_CLASS[alert.severity]}`}>
                  {formatAlertType(alert.type)}
                </span>
                <span className="text-xs text-slate-500">{alert.severity}</span>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">{alert.reason}</p>
              {alert.recommendedSteps.length > 0 && (
                <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-slate-500">
                  {alert.recommendedSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">
                  {new Date(alert.detectedAt).toLocaleString()}
                </span>
                <select
                  aria-label={`Update status for ${formatAlertType(alert.type)} alert`}
                  value={alert.status}
                  disabled={updatingId === alert.id}
                  onChange={(event) => updateStatus(alert.id, event.target.value as AlertStatus)}
                  className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs text-slate-200"
                >
                  {ALERT_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
      </div>
    </aside>
  );
}
