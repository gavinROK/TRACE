import type { ReactNode } from "react";
import type { ActivityLevel, NodeKind } from "@/lib/types";

const ACTIVITY_OPTIONS: { value: ActivityLevel | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const METRIC_OPTIONS: { value: NodeKind; label: string }[] = [
  { value: "github", label: "GitHub" },
  { value: "apiUsage", label: "API Usage" },
  { value: "security", label: "Security" },
];

interface FilterBarProps {
  activityFilter: ActivityLevel | "all";
  onActivityFilterChange: (value: ActivityLevel | "all") => void;
  hiddenMetricKinds: Set<NodeKind>;
  onToggleMetricKind: (kind: NodeKind) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onExportJsonCanvas: () => void;
  /** Omitted entirely in demo mode — there's no backend to connect to. */
  onConnectGithub?: () => void;
  /** Omitted entirely in demo mode — there's no backend to enroll into. */
  onEnrollDevice?: () => void;
}

export function FilterBar({
  activityFilter,
  onActivityFilterChange,
  hiddenMetricKinds,
  onToggleMetricKind,
  onExpandAll,
  onCollapseAll,
  onExportJsonCanvas,
  onConnectGithub,
  onEnrollDevice,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-slate-800 bg-slate-950 px-4 py-2.5">
      <FilterGroup label="Activity">
        {ACTIVITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onActivityFilterChange(option.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              activityFilter === option.value
                ? "bg-cyan-500 text-slate-950"
                : "bg-slate-900 text-slate-400 hover:bg-slate-800"
            }`}
          >
            {option.label}
          </button>
        ))}
      </FilterGroup>

      <FilterGroup label="Show">
        {METRIC_OPTIONS.map((option) => {
          const isVisible = !hiddenMetricKinds.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggleMetricKind(option.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                isVisible
                  ? "bg-slate-800 text-slate-100"
                  : "bg-slate-900 text-slate-500 line-through"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </FilterGroup>

      <div className="ml-auto flex items-center gap-2">
        {onConnectGithub && (
          <button
            type="button"
            onClick={onConnectGithub}
            className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-white"
          >
            Connect GitHub
          </button>
        )}
        {onEnrollDevice && (
          <button
            type="button"
            onClick={onEnrollDevice}
            className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-white"
          >
            Enroll Device
          </button>
        )}
        <button
          type="button"
          onClick={onExpandAll}
          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={onCollapseAll}
          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={onExportJsonCanvas}
          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
        >
          Export JSON Canvas
        </button>
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}
