import type { OrgEntity } from "@/lib/types";

interface DetailPanelProps {
  entity: OrgEntity;
  childEntities: OrgEntity[];
  onClose: () => void;
}

export function DetailPanel({ entity, childEntities, onClose }: DetailPanelProps) {
  return (
    <aside className="absolute right-4 top-4 z-10 w-80 rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{entity.kind}</div>
          <h2 className="text-lg font-semibold text-slate-100">{entity.label}</h2>
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

      <div className="mt-3 space-y-2 text-sm text-slate-300">
        <EntityFields entity={entity} />
      </div>

      {childEntities.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
            {entity.kind === "developer" ? "Metrics" : "Members"}
          </div>
          <ul className="space-y-1.5 text-sm text-slate-300">
            {childEntities.map((child) => (
              <li key={child.id} className="flex items-center justify-between">
                <span>{child.label}</span>
                <span className="text-xs text-slate-500">{child.kind}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
    </div>
  );
}

function EntityFields({ entity }: { entity: OrgEntity }) {
  switch (entity.kind) {
    case "organization":
    case "department":
      return <p className="text-slate-400">{entity.description}</p>;
    case "developer":
      return (
        <>
          <Field label="Role" value={entity.role} />
          <Field label="Activity" value={entity.activity} />
          <Field label="Commits this week" value={entity.commitsThisWeek} />
          <Field label="Open pull requests" value={entity.openPullRequests} />
        </>
      );
    case "github":
      return (
        <>
          <Field label="Repositories" value={entity.repositories} />
          <Field label="Commits this week" value={entity.commitsThisWeek} />
          <Field label="Open pull requests" value={entity.openPullRequests} />
        </>
      );
    case "apiUsage":
      return (
        <>
          <Field label="Requests today" value={entity.requestsToday.toLocaleString()} />
          <Field label="Error rate" value={`${entity.errorRatePercent}%`} />
        </>
      );
    case "security":
      return (
        <>
          <Field label="Open alerts" value={entity.openAlerts} />
          <Field label="Severity" value={entity.severity} />
        </>
      );
  }
}
