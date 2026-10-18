import type { BackendMode } from "@/lib/useGraphData";

interface BackendStatusBadgeProps {
  mode: BackendMode;
  organizationName?: string;
  developerCount?: number;
}

/**
 * Purely presentational — fed by the same fetch useGraphData already made
 * for the graph itself, so this never triggers a second network request.
 */
export function BackendStatusBadge({ mode, organizationName, developerCount }: BackendStatusBadgeProps) {
  const label =
    mode === "live"
      ? `Live — connected to ${organizationName} (${developerCount} developers)`
      : mode === "demo"
        ? "Demo mode — showing simulated data"
        : "Checking backend…";

  const dotClass = mode === "live" ? "bg-emerald-400" : mode === "demo" ? "bg-amber-400" : "bg-slate-500";
  const containerClass =
    mode === "live"
      ? "border-emerald-800 bg-emerald-950/50 text-emerald-400"
      : mode === "demo"
        ? "border-amber-800 bg-amber-950/40 text-amber-400"
        : "border-slate-700 bg-slate-900 text-slate-500";

  return (
    <span
      data-testid="backend-status-badge"
      data-mode={mode}
      className={`ml-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${containerClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}
