"use client";

import type { InfraDashboardSummary, InfraDeviceSummary } from "@/lib/infra-types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${units[exponent]}`;
}

interface OverviewViewProps {
  summary: InfraDashboardSummary;
  devices: InfraDeviceSummary[];
  onOpenDiscovery: () => void;
  onSelectDevice: (id: string) => void;
}

export function OverviewView({ summary, devices, onOpenDiscovery, onSelectDevice }: OverviewViewProps) {
  const unenrolled = devices.filter((d) => d.enrollmentStatus !== "ENROLLED").length;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Overview</h1>
        <button
          onClick={onOpenDiscovery}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Discover My Network
        </button>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-3">
        <StatCard label="Devices" value={summary.totalDevices} />
        <StatCard label="Online" value={summary.onlineDevices} valueClass="text-emerald-400" />
        <StatCard label="Offline" value={summary.offlineDevices} valueClass="text-red-400" />
        <StatCard label="Unenrolled" value={unenrolled} valueClass="text-amber-400" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatCard
          label={`Memory (${summary.aggregateMemory.hostsReporting} host${summary.aggregateMemory.hostsReporting === 1 ? "" : "s"} reporting)`}
          value={`${formatBytes(summary.aggregateMemory.usedBytes)} / ${formatBytes(summary.aggregateMemory.totalBytes)}`}
        />
        <StatCard
          label={`Storage (${summary.aggregateStorage.hostsReporting} host${summary.aggregateStorage.hostsReporting === 1 ? "" : "s"} reporting)`}
          value={`${formatBytes(summary.aggregateStorage.usedBytes)} / ${formatBytes(summary.aggregateStorage.totalBytes)}`}
        />
      </div>
      {summary.aggregateMemory.hostsReporting === 0 && (
        <p className="mt-2 text-xs text-slate-500">
          No hosts are reporting memory/storage yet — enroll a device with a credential and run &quot;Test connection&quot; to start collecting real metrics.
        </p>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-300">Devices needing attention</h2>
        {unenrolled === 0 ? (
          <p className="mt-2 text-xs text-slate-500">Every device is enrolled.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {devices
              .filter((d) => d.enrollmentStatus !== "ENROLLED")
              .map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => onSelectDevice(d.id)}
                    className="flex w-full items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs hover:border-slate-600"
                  >
                    <span className="text-slate-200">{d.name}</span>
                    <span className="text-slate-500">
                      {d.ipAddresses.length === 0 ? "No management address" : "No credential enrolled"}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, valueClass }: { label: string; value: string | number; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${valueClass ?? "text-slate-100"}`}>{value}</div>
    </div>
  );
}
