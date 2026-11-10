"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { infraApi, InfraApiError } from "@/lib/infra-api";
import type { InfraCommandRun } from "@/lib/infra-types";

interface CommandConsoleProps {
  environmentId: string;
  initialDeviceName: string;
  onClose: () => void;
}

/** Remount this component (pass `key={environmentId + initialDeviceName}`
 * or similar from the caller) when either prop should reset the console
 * to a fresh target — state here is not kept in sync with props via an
 * effect. */
export function CommandConsole({ environmentId, initialDeviceName, onClose }: CommandConsoleProps) {
  const [deviceName, setDeviceName] = useState(initialDeviceName);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<InfraCommandRun[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refreshHistory = useCallback(() => {
    // History is a convenience; a failure to load it shouldn't block the
    // console itself, so a rejected fetch is swallowed rather than surfaced.
    return infraApi.listCommandRuns(environmentId, 50).then(setHistory).catch(() => undefined);
  }, [environmentId]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [history]);

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

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 h-72 border-t border-slate-700 bg-slate-950/98 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-100">Command console</h2>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300" aria-label="Close console">
          ✕
        </button>
      </div>

      <div ref={logRef} className="h-[calc(100%-6.5rem)] overflow-y-auto px-4 py-2 font-mono text-xs">
        {history.length === 0 && <p className="text-slate-600">No commands run yet in this environment.</p>}
        {history
          .slice()
          .reverse()
          .map((run, i) => (
            <div key={run.id ?? i} className="mb-2">
              <div className="text-slate-500">
                <span className="text-sky-400">{run.targetLabel}</span> $ {run.command}{" "}
                <StatusTag status={run.status} />
              </div>
              {run.stdout && <pre className="whitespace-pre-wrap text-slate-300">{run.stdout}</pre>}
              {run.stderr && <pre className="whitespace-pre-wrap text-red-400">{run.stderr}</pre>}
            </div>
          ))}
      </div>

      <form onSubmit={handleRun} className="flex gap-2 border-t border-slate-800 px-4 py-2">
        <input
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="device"
          className="w-32 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-500"
        />
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder='trace exec beelink "uptime"'
          className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={running}
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
