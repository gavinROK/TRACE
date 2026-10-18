"use client";

import { useEffect, useState } from "react";
import type { DailyUsagePoint, ProviderUsageSummary } from "@/lib/telemetry";

interface ApiUsageDashboardPanelProps {
  onClose: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; summary: ProviderUsageSummary[]; trend: DailyUsagePoint[] };

export function ApiUsageDashboardPanel({ onClose }: ApiUsageDashboardPanelProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/trace/telemetry/summary").then((res) => {
        if (!res.ok) throw new Error(`summary request failed (${res.status})`);
        return res.json() as Promise<ProviderUsageSummary[]>;
      }),
      fetch("/api/trace/telemetry/trend?days=14").then((res) => {
        if (!res.ok) throw new Error(`trend request failed (${res.status})`);
        return res.json() as Promise<DailyUsagePoint[]>;
      }),
    ])
      .then(([summary, trend]) => {
        if (!cancelled) setState({ status: "ready", summary, trend });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Failed to load API usage data",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const maxTrendRequests =
    state.status === "ready" ? Math.max(...state.trend.map((point) => point.requestCount), 1) : 1;

  return (
    <aside
      data-testid="api-usage-dashboard-panel"
      className="absolute right-4 top-4 z-10 w-[26rem] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">api usage dashboard</div>
          <h2 className="text-lg font-semibold text-slate-100">API Usage</h2>
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

      {state.status === "loading" && (
        <p className="mt-4 text-sm text-slate-500">Loading usage data…</p>
      )}
      {state.status === "error" && (
        <p className="mt-4 text-sm text-rose-400">{state.message}</p>
      )}
      {state.status === "ready" && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">By provider</div>
            {state.summary.length === 0 ? (
              <p className="text-sm text-slate-500">No API usage reported yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-1 font-normal">Provider</th>
                    <th className="pb-1 font-normal text-right">Requests</th>
                    <th className="pb-1 font-normal text-right">Cost</th>
                    <th className="pb-1 font-normal text-right">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {state.summary.map((row) => (
                    <tr key={row.provider} className="border-t border-slate-800">
                      <td className="py-1.5 text-slate-200">{row.provider}</td>
                      <td className="py-1.5 text-right text-slate-300">
                        {row.requestCount.toLocaleString()}
                      </td>
                      <td className="py-1.5 text-right text-slate-300">
                        ${row.estimatedCostUsd.toFixed(2)}
                      </td>
                      <td className="py-1.5 text-right text-slate-300">{row.errorCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
              Last 14 days (requests/day)
            </div>
            {state.trend.length === 0 ? (
              <p className="text-sm text-slate-500">No usage in this window.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {state.trend.map((point) => (
                  <div key={point.date} className="flex items-center gap-2 text-xs">
                    <span className="w-20 flex-shrink-0 text-slate-400">{point.date}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-slate-800">
                      <div
                        className="h-1.5 rounded-full bg-cyan-500"
                        style={{ width: `${(point.requestCount / maxTrendRequests) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 flex-shrink-0 text-right text-slate-500">
                      {point.requestCount}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
