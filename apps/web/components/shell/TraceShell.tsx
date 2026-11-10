"use client";

import { useEffect, useState } from "react";
import { infraApi } from "@/lib/infra-api";
import type { InfraEnvironment } from "@/lib/infra-types";
import { AuthGate } from "@/components/infra/AuthGate";
import { Workspace } from "./Workspace";

export function TraceShell() {
  return <AuthGate>{(actor, onLogout) => <EnvironmentPicker actor={actor} onLogout={onLogout} />}</AuthGate>;
}

function EnvironmentPicker({ actor, onLogout }: { actor: string; onLogout: () => void }) {
  const [environments, setEnvironments] = useState<InfraEnvironment[] | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
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

  async function handleCreate(name: string, slug: string) {
    const created = await infraApi.createEnvironment(name, slug);
    setEnvironments((prev) => [...(prev ?? []), created]);
    setEnvironmentId(created.id);
    setIsCreating(false);
  }

  if (error) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-red-400">{error}</div>;
  }

  if (environments === null) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-500">Loading…</div>;
  }

  if (environments.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-slate-100">
        <p className="text-sm text-slate-400">No environments yet.</p>
        {isCreating ? (
          <CreateEnvironmentForm onCancel={() => setIsCreating(false)} onCreate={handleCreate} />
        ) : (
          <button onClick={() => setIsCreating(true)} className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">
            Create an environment
          </button>
        )}
      </div>
    );
  }

  const environment = environments.find((e) => e.id === environmentId) ?? environments[0];

  return (
    <Workspace
      key={environment.id}
      actor={actor}
      onLogout={onLogout}
      environment={environment}
      environments={environments}
      onSelectEnvironment={setEnvironmentId}
      onEnvironmentCreated={handleCreate}
    />
  );
}

function CreateEnvironmentForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string, slug: string) => Promise<void> }) {
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
    <form onSubmit={handleSubmit} className="w-80 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
      <label className="block text-xs uppercase tracking-wide text-slate-500">Name</label>
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
        <button type="submit" disabled={submitting || !slug} className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50">
          {submitting ? "…" : "Create"}
        </button>
      </div>
    </form>
  );
}
