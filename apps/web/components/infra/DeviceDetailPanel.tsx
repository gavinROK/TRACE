"use client";

import { useCallback, useEffect, useState } from "react";
import { infraApi } from "@/lib/infra-api";
import type { InfraDeviceDetail } from "@/lib/infra-types";

const STATUS_LABEL: Record<string, string> = { ONLINE: "Online", OFFLINE: "Offline", UNKNOWN: "Unknown" };
const STATUS_COLOR: Record<string, string> = {
  ONLINE: "text-emerald-400",
  OFFLINE: "text-red-400",
  UNKNOWN: "text-slate-500",
};

interface DeviceDetailPanelProps {
  environmentId: string;
  deviceId: string;
  onClose: () => void;
  onOpenConsole: (deviceName: string) => void;
  onChanged: () => void;
}

export function DeviceDetailPanel({ environmentId, deviceId, onClose, onOpenConsole, onChanged }: DeviceDetailPanelProps) {
  const [device, setDevice] = useState<InfraDeviceDetail | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return infraApi
      .getDevice(environmentId, deviceId)
      .then(setDevice)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load device"));
  }, [environmentId, deviceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCheckHealth() {
    setChecking(true);
    try {
      await infraApi.checkDeviceHealth(environmentId, deviceId);
      await load();
      onChanged();
    } finally {
      setChecking(false);
    }
  }

  if (error) {
    return <Panel onClose={onClose}>{error}</Panel>;
  }
  if (!device) {
    return <Panel onClose={onClose}>Loading…</Panel>;
  }

  const canExec = device.managementProtocols.includes("SSH");

  return (
    <Panel onClose={onClose}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{device.category.replace(/_/g, " ")}</div>
          <h2 className="text-lg font-semibold text-slate-100">{device.name}</h2>
        </div>
        <span className={`text-xs font-medium ${STATUS_COLOR[device.onlineState]}`}>{STATUS_LABEL[device.onlineState]}</span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Field label="Manufacturer" value={device.manufacturer} />
        <Field label="Model" value={device.model} />
        <Field label="OS" value={device.operatingSystem} />
        <Field label="OS version" value={device.osVersion} />
        <Field label="IP" value={device.ipAddresses.join(", ") || null} />
        <Field label="Enrollment" value={device.enrollmentStatus} />
        <Field label="Last contact" value={device.lastContactAt ? new Date(device.lastContactAt).toLocaleString() : null} />
        {device.parentDevice && <Field label="Hosted on" value={device.parentDevice.name} />}
      </dl>

      <div className="mt-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Capabilities</div>
        {device.capabilities.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">
            None — enroll credentials for this device to unlock health checks, metrics, or command execution.
          </p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1">
            {device.capabilities.map((cap, i) => (
              <span key={i} className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                {cap.protocol}: {cap.capability}
              </span>
            ))}
          </div>
        )}
      </div>

      {device.recentMetrics.length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Recent metrics</div>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
            {device.recentMetrics.slice(0, 6).map((m) => (
              <li key={m.id} className="flex justify-between">
                <span>{m.label ? `${m.kind} (${m.label})` : m.kind}</span>
                <span className="text-slate-400">
                  {m.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} {m.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <button
          onClick={handleCheckHealth}
          disabled={checking}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-50"
        >
          {checking ? "Checking…" : "Check health"}
        </button>
        {canExec && (
          <button
            onClick={() => onOpenConsole(device.name)}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          >
            Open console
          </button>
        )}
      </div>
    </Panel>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-slate-200">{value}</div>
    </div>
  );
}

function Panel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <aside className="absolute right-4 top-4 z-10 max-h-[calc(100vh-2rem)] w-80 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-sm">
      <button onClick={onClose} className="absolute right-3 top-3 text-slate-500 hover:text-slate-300" aria-label="Close">
        ✕
      </button>
      {children}
    </aside>
  );
}
