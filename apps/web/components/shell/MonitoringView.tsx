"use client";

import type { InfraDeviceSummary } from "@/lib/infra-types";

const STATUS_COLOR: Record<string, string> = { ONLINE: "text-emerald-400", OFFLINE: "text-red-400", UNKNOWN: "text-slate-500" };

interface MonitoringViewProps {
  devices: InfraDeviceSummary[];
  onSelect: (id: string) => void;
}

export function MonitoringView({ devices, onSelect }: MonitoringViewProps) {
  const reporting = devices.filter((d) => d.enrollmentStatus === "ENROLLED");
  const notReporting = devices.filter((d) => d.enrollmentStatus !== "ENROLLED");

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-lg font-semibold text-slate-100">Monitoring</h1>

      <h2 className="mt-4 text-sm font-semibold text-slate-300">Enrolled devices</h2>
      {reporting.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No devices are enrolled yet — enroll one from the Devices view to start collecting metrics.</p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-3">
          {reporting.map((d) => (
            <button
              key={d.id}
              onClick={() => onSelect(d.id)}
              className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-left hover:border-slate-600"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-100">{d.name}</span>
                <span className={`text-xs font-medium ${STATUS_COLOR[d.onlineState]}`}>{d.onlineState}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {d.lastContactAt ? `Last contact ${new Date(d.lastContactAt).toLocaleString()}` : "No successful contact yet"}
              </div>
            </button>
          ))}
        </div>
      )}

      <h2 className="mt-6 text-sm font-semibold text-slate-300">Not yet reporting</h2>
      {notReporting.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">Everything is enrolled.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {notReporting.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => onSelect(d.id)}
                className="flex w-full items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs hover:border-slate-600"
              >
                <span className="text-slate-300">{d.name}</span>
                <span className="text-slate-500">{d.enrollmentStatus}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
