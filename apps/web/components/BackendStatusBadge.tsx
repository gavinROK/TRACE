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
  // "People," not "developers" — a real organization's Developer records
  // (the underlying model's name, kept for now — see
  // docs/DEVELOPMENT_STATUS.md) represent every employee TRACE knows
  // about, including Sales, HR, and Support staff who have no GitHub or
  // API activity at all. Calling all of them "developers" in a status
  // message an IT admin reads first was found misleading during the
  // product evaluation.
  const label =
    mode === "live"
      ? `Live — connected to ${organizationName} (${developerCount} people)`
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
