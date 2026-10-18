import type { OrgStats } from "@/lib/stats";

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex min-w-[140px] flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-2xl font-semibold text-slate-100">{value}</span>
    </div>
  );
}

export function StatsRow({ stats }: { stats: OrgStats }) {
  const maxCommits = Math.max(...stats.topContributors.map((c) => c.commitsThisWeek), 1);

  return (
    <div className="flex flex-wrap items-stretch gap-3 border-b border-slate-800 bg-slate-950 px-4 py-3">
      <StatTile label="Developers" value={stats.developerCount} />
      <StatTile label="Open Pull Requests" value={stats.openPullRequests} />
      <StatTile label="API Requests / Day" value={stats.apiRequestsToday.toLocaleString()} />
      <StatTile label="Open Security Alerts" value={stats.openSecurityAlerts} />

      <div className="flex min-w-[240px] flex-1 flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
        <span className="text-xs uppercase tracking-wide text-slate-500">
          Top Contributors This Week
        </span>
        <div className="flex flex-col gap-1.5">
          {stats.topContributors.map((contributor) => (
            <div key={contributor.label} className="flex items-center gap-2 text-xs">
              <span className="w-24 flex-shrink-0 truncate text-slate-300">
                {contributor.label}
              </span>
              <div className="h-1.5 flex-1 rounded-full bg-slate-800">
                <div
                  className="h-1.5 rounded-full bg-cyan-500"
                  style={{ width: `${(contributor.commitsThisWeek / maxCommits) * 100}%` }}
                />
              </div>
              <span className="w-8 flex-shrink-0 text-right text-slate-500">
                {contributor.commitsThisWeek}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
