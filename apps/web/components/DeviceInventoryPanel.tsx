"use client";

import { useMemo, useState } from "react";
import type { DeviceEntity, DevicePostureStatus } from "@/lib/types";
import { DEVICE_TYPE_OPTIONS } from "@/lib/device";

interface DeviceInventoryPanelProps {
  devices: DeviceEntity[];
  onClose: () => void;
  onSelectDevice: (id: string) => void;
}

const POSTURE_FILTER_OPTIONS: Array<DevicePostureStatus | "ALL"> = [
  "ALL",
  "HEALTHY",
  "AT_RISK",
  "CRITICAL",
  "UNKNOWN",
];

const POSTURE_DOT_CLASS: Record<DevicePostureStatus, string> = {
  HEALTHY: "bg-emerald-400",
  AT_RISK: "bg-amber-400",
  CRITICAL: "bg-rose-400",
  UNKNOWN: "bg-slate-500",
};

function matchesSearch(device: DeviceEntity, query: string): boolean {
  if (!query) return true;
  const haystack = [
    device.label,
    device.operatingSystem,
    device.osVersion,
    device.ownerName ?? "",
    device.departmentName ?? "",
    device.serialNumber ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function DeviceInventoryPanel({ devices, onClose, onSelectDevice }: DeviceInventoryPanelProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [postureFilter, setPostureFilter] = useState<DevicePostureStatus | "ALL">("ALL");

  const summary = useMemo(() => {
    const counts: Record<DevicePostureStatus, number> = {
      HEALTHY: 0,
      AT_RISK: 0,
      CRITICAL: 0,
      UNKNOWN: 0,
    };
    for (const device of devices) counts[device.posture.status] += 1;
    return counts;
  }, [devices]);

  const filtered = useMemo(
    () =>
      devices.filter(
        (device) =>
          matchesSearch(device, query) &&
          (typeFilter === "ALL" || device.deviceType === typeFilter) &&
          (postureFilter === "ALL" || device.posture.status === postureFilter),
      ),
    [devices, query, typeFilter, postureFilter],
  );

  return (
    <aside
      data-testid="device-inventory-panel"
      className="absolute right-4 top-4 z-10 w-[30rem] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">device inventory</div>
          <h2 className="text-lg font-semibold text-slate-100">Devices &amp; Assets</h2>
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

      <div className="mt-3 grid grid-cols-5 gap-1.5 text-center">
        <SummaryTile label="Total" value={devices.length} />
        <SummaryTile label="Healthy" value={summary.HEALTHY} className="text-emerald-400" />
        <SummaryTile label="At risk" value={summary.AT_RISK} className="text-amber-400" />
        <SummaryTile label="Critical" value={summary.CRITICAL} className="text-rose-400" />
        <SummaryTile label="Unknown" value={summary.UNKNOWN} className="text-slate-400" />
      </div>

      <div className="mt-3 space-y-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, owner, department, OS, serial…"
          data-testid="device-inventory-search"
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
        />
        <div className="flex gap-2">
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="Filter by device type"
            className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
          >
            <option value="ALL">All types</option>
            {DEVICE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={postureFilter}
            onChange={(event) => setPostureFilter(event.target.value as DevicePostureStatus | "ALL")}
            aria-label="Filter by security posture"
            className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
          >
            {POSTURE_FILTER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All posture statuses" : option.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 border-t border-slate-800 pt-2">
        <div className="mb-1.5 text-xs text-slate-500">
          {filtered.length} of {devices.length} device{devices.length === 1 ? "" : "s"}
        </div>
        <ul className="space-y-1.5">
          {filtered.map((device) => (
            <li key={device.id}>
              <button
                type="button"
                data-testid={`device-inventory-row-${device.id}`}
                onClick={() => onSelectDevice(device.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 text-left hover:border-slate-600"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-100">{device.label}</div>
                  <div className="truncate text-xs text-slate-500">
                    {device.operatingSystem} {device.osVersion} ·{" "}
                    {device.ownerName ?? device.departmentName ?? "Unassigned"}
                  </div>
                </div>
                <span className="flex flex-shrink-0 items-center gap-1.5 text-xs text-slate-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${POSTURE_DOT_CLASS[device.posture.status]}`} />
                  {device.posture.status.replace("_", " ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {filtered.length === 0 && (
          <p className="py-2 text-sm text-slate-500">No devices match these filters.</p>
        )}
      </div>
    </aside>
  );
}

function SummaryTile({
  label,
  value,
  className = "text-slate-100",
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/40 py-1.5">
      <div className={`text-sm font-semibold ${className}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
