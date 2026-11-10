"use client";

import { useCallback, useEffect, useState } from "react";
import { infraApi } from "@/lib/infra-api";
import type { InfraEnvironment, InfraTopologySnapshot } from "@/lib/infra-types";
import { AuthGate } from "./AuthGate";
import { InfraTopologyGraph } from "./InfraTopologyGraph";
import { DeviceDetailPanel } from "./DeviceDetailPanel";
import { CommandConsole } from "./CommandConsole";

export function InfraApp() {
  return <AuthGate>{(actor, onLogout) => <InfraWorkspace actor={actor} onLogout={onLogout} />}</AuthGate>;
}

function InfraWorkspace({ actor, onLogout }: { actor: string; onLogout: () => void }) {
  const [environments, setEnvironments] = useState<InfraEnvironment[] | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [isCreatingEnvironment, setIsCreatingEnvironment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void infraApi
      .listEnvironments()
      .then((envs) => {
        setEnvironments(envs);
        if (envs.length > 0) setEnvironmentId(envs[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load environments"));
  }, []);

  async function handleCreateEnvironment(name: string, slug: string) {
    const created = await infraApi.createEnvironment(name, slug);
    setEnvironments((prev) => [...(prev ?? []), created]);
    setEnvironmentId(created.id);
    setIsCreatingEnvironment(false);
  }

  return (
    <div className="relative flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-wide text-slate-200">TRACE · Infrastructure</h1>
          {environments && environments.length > 0 && (
            <select
              value={environmentId ?? ""}
              onChange={(e) => setEnvironmentId(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            >
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name} ({env.deviceCount})
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setIsCreatingEnvironment(true)}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
          >
            + Environment
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>{actor}</span>
          <button onClick={onLogout} className="rounded-md border border-slate-700 px-2 py-1 hover:text-slate-200">
            Sign out
          </button>
        </div>
      </header>

      <main className="relative flex-1">
        {error && <p className="p-4 text-sm text-red-400">{error}</p>}
        {!error && environments?.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            No environments yet — create one to get started.
          </div>
        )}
        {/* Keyed by environmentId so switching environments always starts
            this subtree's selection/console/snapshot state fresh, instead
            of syncing it via an effect. */}
        {environmentId && <EnvironmentWorkspace key={environmentId} environmentId={environmentId} />}
      </main>

      {isCreatingEnvironment && (
        <CreateEnvironmentModal onCancel={() => setIsCreatingEnvironment(false)} onCreate={handleCreateEnvironment} />
      )}
    </div>
  );
}

function EnvironmentWorkspace({ environmentId }: { environmentId: string }) {
  const [snapshot, setSnapshot] = useState<InfraTopologySnapshot | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [consoleTarget, setConsoleTarget] = useState<string | null>(null);

  const refreshTopology = useCallback(() => {
    void infraApi.getTopology(environmentId).then(setSnapshot);
  }, [environmentId]);

  useEffect(() => {
    refreshTopology();
  }, [refreshTopology]);

  return (
    <div className="flex h-full flex-col">
      {snapshot && <SummaryBar summary={snapshot.summary} />}

      <div className="relative flex-1">
        {snapshot && <InfraTopologyGraph snapshot={snapshot} selectedId={selectedDeviceId} onSelect={setSelectedDeviceId} />}

        {selectedDeviceId && (
          <DeviceDetailPanel
            environmentId={environmentId}
            deviceId={selectedDeviceId}
            onClose={() => setSelectedDeviceId(null)}
            onOpenConsole={(deviceName) => setConsoleTarget(deviceName)}
            onChanged={refreshTopology}
          />
        )}

        {consoleTarget !== null && (
          <CommandConsole
            key={consoleTarget}
            environmentId={environmentId}
            initialDeviceName={consoleTarget}
            onClose={() => setConsoleTarget(null)}
          />
        )}

        {!consoleTarget && (
          <button
            onClick={() => setConsoleTarget("")}
            className="absolute bottom-4 left-4 z-10 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            Open console
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryBar({ summary }: { summary: InfraTopologySnapshot["summary"] }) {
  return (
    <div className="grid grid-cols-5 gap-px border-b border-slate-800 bg-slate-800 text-xs">
      <Stat label="Devices" value={summary.totalDevices} />
      <Stat label="Online" value={summary.onlineDevices} valueClass="text-emerald-400" />
      <Stat label="Offline" value={summary.offlineDevices} valueClass="text-red-400" />
      <Stat
        label="Memory (reporting hosts)"
        value={`${formatBytes(summary.aggregateMemory.usedBytes)} / ${formatBytes(summary.aggregateMemory.totalBytes)}`}
      />
      <Stat
        label="Storage (reporting hosts)"
        value={`${formatBytes(summary.aggregateStorage.usedBytes)} / ${formatBytes(summary.aggregateStorage.totalBytes)}`}
      />
    </div>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string | number; valueClass?: string }) {
  return (
    <div className="bg-slate-950 px-4 py-2">
      <div className="text-slate-500">{label}</div>
      <div className={`text-base font-semibold ${valueClass ?? "text-slate-100"}`}>{value}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${units[exponent]}`;
}

function CreateEnvironmentModal({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string, slug: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name.trim(), slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create environment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
      <form onSubmit={handleSubmit} className="w-80 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100">New environment</h2>
        <label className="mt-3 block text-xs uppercase tracking-wide text-slate-500">Name</label>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Gavin's Home Infrastructure"
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        {slug && <p className="mt-1 text-[10px] text-slate-500">slug: {slug}</p>}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !slug}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {submitting ? "…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
