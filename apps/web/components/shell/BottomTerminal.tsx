"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { infraApi, InfraApiError } from "@/lib/infra-api";
import type { InfraCommandRun, InfraDeviceSummary } from "@/lib/infra-types";

/** A pure function of (deviceName, devices) — computed during render,
 * not synced via an effect, since it never needs to "catch up" after
 * the fact; it's always derivable from what's already in props/state. */
function useDeviceHint(deviceName: string, devices: InfraDeviceSummary[]): string | null {
  return useMemo(() => {
    const trimmed = deviceName.trim();
    if (!trimmed) return null;
    const device = devices.find((d) => d.name.toLowerCase() === trimmed.toLowerCase());
    if (!device) return `No device named "${trimmed}" in this environment.`;
    if (device.enrollmentStatus !== "ENROLLED" || !device.managementProtocols.includes("SSH")) {
      const missing = device.ipAddresses.length === 0 ? "a management IP address" : "an SSH credential";
      return `Device: ${device.name}\nStatus: Not enrolled for SSH\nManagement address: ${device.ipAddresses[0] ?? "Missing"}\nMissing: ${missing} — open Devices → ${device.name} to configure connectivity.`;
    }
    return null;
  }, [deviceName, devices]);
}

const COMMAND_SUGGESTIONS = ["uptime", "df -h", "free -h", "whoami", "systemctl status", "cat /etc/os-release"];

interface BottomTerminalProps {
  environmentId: string;
  devices: InfraDeviceSummary[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  initialDeviceName?: string;
}

/** Remount this component (the caller passes `key={initialDeviceName}`)
 * when the target device should reset — state here is not kept in sync
 * with props via an effect. */
export function BottomTerminal({ environmentId, devices, collapsed, onToggleCollapsed, initialDeviceName }: BottomTerminalProps) {
  const [deviceName, setDeviceName] = useState(initialDeviceName ?? "");
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<InfraCommandRun[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refreshHistory = useCallback(() => {
    return infraApi.listCommandRuns(environmentId, 50).then(setHistory).catch(() => undefined);
  }, [environmentId]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (!collapsed) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [history, collapsed]);

  const hint = useDeviceHint(deviceName, devices);

  async function handleRun(event: React.FormEvent) {
    event.preventDefault();
    if (!deviceName.trim() || !command.trim()) return;
    setRunning(true);
    setError(null);
    try {
      await infraApi.execCommand(environmentId, deviceName.trim(), command.trim());
      setCommand("");
      await refreshHistory();
    } catch (err) {
      setError(err instanceof InfraApiError ? err.message : "Command failed to run");
    } finally {
      setRunning(false);
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        className="flex h-9 shrink-0 items-center gap-2 border-t border-slate-800 bg-slate-950 px-4 text-xs text-slate-400 hover:text-slate-200"
      >
        <span>▸</span> Console {history.length > 0 && <span className="text-slate-600">· {history.length} runs</span>}
      </button>
    );
  }

  return (
    <div className="flex h-72 shrink-0 flex-col border-t border-slate-700 bg-slate-950/98">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-100">Console</h2>
        <button onClick={onToggleCollapsed} className="text-slate-500 hover:text-slate-300" aria-label="Collapse console">
          ▾
        </button>
      </div>

      <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs">
        {history.length === 0 && <p className="text-slate-600">No commands run yet in this environment.</p>}
        {history
          .slice()
          .reverse()
          .map((run, i) => (
            <div key={run.id ?? i} className="mb-2">
              <div className="text-slate-500">
                <span className="text-sky-400">{run.targetLabel}</span> $ {run.command} <StatusTag status={run.status} />
              </div>
              {run.stdout && <pre className="whitespace-pre-wrap text-slate-300">{run.stdout}</pre>}
              {run.stderr && <pre className="whitespace-pre-wrap text-red-400">{run.stderr}</pre>}
            </div>
          ))}
      </div>

      {hint && <pre className="whitespace-pre-wrap border-t border-slate-800 px-4 py-2 font-mono text-[11px] text-amber-400">{hint}</pre>}

      <form onSubmit={handleRun} className="flex gap-2 border-t border-slate-800 px-4 py-2">
        <input
          list="trace-device-names"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="device"
          className="w-36 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-500"
        />
        <datalist id="trace-device-names">
          {devices.map((d) => (
            <option key={d.id} value={d.name} />
          ))}
        </datalist>
        <input
          list="trace-command-suggestions"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder='exec "uptime"'
          className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
        />
        <datalist id="trace-command-suggestions">
          {COMMAND_SUGGESTIONS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={running || Boolean(hint)}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {running ? "Running…" : "Run"}
        </button>
      </form>
      {error && <p className="px-4 pb-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  SUCCEEDED: "text-emerald-400",
  FAILED: "text-red-400",
  TIMED_OUT: "text-amber-400",
  CANCELLED: "text-slate-500",
  RUNNING: "text-sky-400",
  PENDING: "text-slate-500",
};

function StatusTag({ status }: { status: string }) {
  return <span className={STATUS_COLOR[status] ?? "text-slate-500"}>[{status.toLowerCase()}]</span>;
}
