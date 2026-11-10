"use client";

import { useCallback, useEffect, useState } from "react";
import { infraApi } from "@/lib/infra-api";
import type { InfraDeviceSummary, InfraEnvironment, InfraTopologySnapshot } from "@/lib/infra-types";
import { Sidebar, type ShellView } from "./Sidebar";
import { BottomTerminal } from "./BottomTerminal";
import { DeviceRightPanel } from "./DeviceRightPanel";
import { DiscoveryModal } from "./DiscoveryModal";
import { OverviewView } from "./OverviewView";
import { TopologyView } from "./TopologyView";
import { DevicesView } from "./DevicesView";
import { MonitoringView } from "./MonitoringView";
import { SettingsView } from "./SettingsView";

interface WorkspaceProps {
  actor: string;
  onLogout: () => void;
  environment: InfraEnvironment;
  environments: InfraEnvironment[];
  onSelectEnvironment: (id: string) => void;
  onEnvironmentCreated: (name: string, slug: string) => Promise<void>;
}

export function Workspace({ actor, onLogout, environment, environments, onSelectEnvironment, onEnvironmentCreated }: WorkspaceProps) {
  const [activeView, setActiveView] = useState<ShellView>("overview");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [terminalTarget, setTerminalTarget] = useState<string | undefined>(undefined);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [devices, setDevices] = useState<InfraDeviceSummary[]>([]);
  const [snapshot, setSnapshot] = useState<InfraTopologySnapshot | null>(null);
  const [showCreateEnv, setShowCreateEnv] = useState(false);

  const refresh = useCallback(() => {
    return Promise.all([infraApi.listDevices(environment.id), infraApi.getTopology(environment.id)]).then(
      ([deviceList, topology]) => {
        setDevices(deviceList);
        setSnapshot(topology);
      },
    );
  }, [environment.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openConsoleFor(deviceName: string) {
    setTerminalTarget(deviceName);
    setTerminalCollapsed(false);
  }

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <select
            value={environment.id}
            onChange={(e) => onSelectEnvironment(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          >
            {environments.map((env) => (
              <option key={env.id} value={env.id}>{env.name} ({env.deviceCount})</option>
            ))}
          </select>
          <button onClick={() => setShowCreateEnv(true)} className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-slate-200">
            + Environment
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>{actor}</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onSelectView={setActiveView} onOpenConsole={() => setTerminalCollapsed(false)} />

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            <div className="relative flex-1 overflow-hidden">
              {!snapshot ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading…</div>
              ) : (
                <>
                  {activeView === "overview" && (
                    <OverviewView
                      summary={snapshot.summary}
                      devices={devices}
                      onOpenDiscovery={() => setDiscoveryOpen(true)}
                      onSelectDevice={(id) => {
                        setSelectedDeviceId(id);
                        setActiveView("devices");
                      }}
                    />
                  )}
                  {activeView === "topology" && (
                    <TopologyView snapshot={snapshot} selectedId={selectedDeviceId} onSelect={setSelectedDeviceId} />
                  )}
                  {activeView === "devices" && (
                    <DevicesView
                      environmentId={environment.id}
                      devices={devices}
                      selectedId={selectedDeviceId}
                      onSelect={setSelectedDeviceId}
                      onChanged={refresh}
                    />
                  )}
                  {activeView === "monitoring" && <MonitoringView devices={devices} onSelect={setSelectedDeviceId} />}
                  {activeView === "settings" && <SettingsView actor={actor} environment={environment} onLogout={onLogout} />}
                </>
              )}

              {discoveryOpen && (
                <DiscoveryModal
                  environmentId={environment.id}
                  onClose={() => setDiscoveryOpen(false)}
                  onImported={refresh}
                />
              )}
            </div>

            {selectedDeviceId && (
              <DeviceRightPanel
                environmentId={environment.id}
                deviceId={selectedDeviceId}
                onClose={() => setSelectedDeviceId(null)}
                onOpenConsole={openConsoleFor}
                onChanged={refresh}
              />
            )}
          </div>

          <BottomTerminal
            key={terminalTarget}
            environmentId={environment.id}
            devices={devices}
            collapsed={terminalCollapsed}
            onToggleCollapsed={() => setTerminalCollapsed((v) => !v)}
            initialDeviceName={terminalTarget}
          />
        </div>
      </div>

      {showCreateEnv && (
        <CreateEnvironmentModal
          onCancel={() => setShowCreateEnv(false)}
          onCreate={async (name, slug) => {
            await onEnvironmentCreated(name, slug);
            setShowCreateEnv(false);
          }}
        />
      )}
    </div>
  );
}

function CreateEnvironmentModal({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string, slug: string) => Promise<void> }) {
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
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50">
      <form onSubmit={handleSubmit} className="w-80 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100">New environment</h2>
        <label className="mt-3 block text-xs uppercase tracking-wide text-slate-500">Name</label>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        {slug && <p className="mt-1 text-[10px] text-slate-500">slug: {slug}</p>}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button type="submit" disabled={submitting || !slug} className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50">
            {submitting ? "…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
