"use client";

import { useEffect, useState } from "react";
import { infraApi } from "@/lib/infra-api";
import type { InfraCredentialSummary, InfraEnvironment } from "@/lib/infra-types";

interface SettingsViewProps {
  actor: string;
  environment: InfraEnvironment;
  onLogout: () => void;
}

export function SettingsView({ actor, environment, onLogout }: SettingsViewProps) {
  const [credentials, setCredentials] = useState<InfraCredentialSummary[]>([]);
  const [auditLog, setAuditLog] = useState<Array<{ id: string; actor: string; action: string; outcome: string; createdAt: string }>>([]);

  useEffect(() => {
    infraApi.listCredentials(environment.id).then(setCredentials).catch(() => undefined);
    infraApi.listAuditLog(environment.id, 30).then(setAuditLog).catch(() => undefined);
  }, [environment.id]);

  async function handleRemoveCredential(id: string) {
    await infraApi.deleteCredential(environment.id, id);
    setCredentials((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-lg font-semibold text-slate-100">Settings</h1>

      <section className="mt-5">
        <h2 className="text-sm font-semibold text-slate-300">Account</h2>
        <p className="mt-1 text-xs text-slate-400">Signed in as {actor}</p>
        <button onClick={onLogout} className="mt-2 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100">
          Sign out
        </button>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-300">Environment</h2>
        <p className="mt-1 text-xs text-slate-400">{environment.name} ({environment.slug}) — {environment.deviceCount} devices</p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-300">Credentials in this environment</h2>
        {credentials.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None yet — add one from a device&apos;s settings panel.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {credentials.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs">
                <span className="text-slate-200">{c.label} <span className="text-slate-500">({c.protocol})</span></span>
                <button onClick={() => handleRemoveCredential(c.id)} className="text-red-400 hover:text-red-300">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-300">Recent audit log</h2>
        {auditLog.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No activity recorded yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 font-mono text-[11px]">
            {auditLog.map((entry) => (
              <li key={entry.id} className="flex justify-between text-slate-400">
                <span>
                  {entry.actor} · {entry.action} ·{" "}
                  <span className={entry.outcome === "success" ? "text-emerald-400" : entry.outcome === "denied" ? "text-amber-400" : "text-red-400"}>
                    {entry.outcome}
                  </span>
                </span>
                <span className="text-slate-600">{new Date(entry.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
