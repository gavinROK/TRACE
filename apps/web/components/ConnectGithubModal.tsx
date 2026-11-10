"use client";

import { useState, type FormEvent } from "react";

interface ConnectGithubModalProps {
  onClose: () => void;
  /** Called after a successful connect + sync, so the graph can refetch. */
  onSynced: () => void;
}

type SubmitState = { status: "idle" | "submitting" } | { status: "error"; message: string };

export function ConnectGithubModal({ onClose, onSynced }: ConnectGithubModalProps) {
  const [installationId, setInstallationId] = useState("");
  const [accountLogin, setAccountLogin] = useState("");
  const [accountType, setAccountType] = useState<"Organization" | "User">("Organization");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setState({ status: "submitting" });

    try {
      const connectResponse = await fetch("/api/trace/github/installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId, accountLogin, accountType }),
      });
      if (!connectResponse.ok) {
        const body = await connectResponse.json().catch(() => ({}));
        throw new Error(body.message ?? `Connect failed (${connectResponse.status})`);
      }
      const installation = await connectResponse.json();

      const syncResponse = await fetch(`/api/trace/github/installations/${installation.id}/sync`, {
        method: "POST",
      });
      if (!syncResponse.ok) {
        throw new Error(`Sync failed (${syncResponse.status})`);
      }

      onSynced();
      onClose();
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Something went wrong",
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        data-testid="connect-github-modal"
        onClick={(event) => event.stopPropagation()}
        className="w-[26rem] rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-100">Connect GitHub</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-400">
          In production, these fields are filled in automatically when you install the TRACE
          GitHub App and GitHub redirects back here. This demo doesn&apos;t have a registered
          App, so enter them manually — a real App installation id, or any values to exercise
          the sync against simulated data (see below).
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block text-xs text-slate-400">
            Installation ID
            <input
              required
              inputMode="numeric"
              pattern="[0-9]+"
              value={installationId}
              onChange={(event) => setInstallationId(event.target.value)}
              placeholder="e.g. 12345678"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
            />
          </label>

          <label className="block text-xs text-slate-400">
            Account login
            <input
              required
              value={accountLogin}
              onChange={(event) => setAccountLogin(event.target.value)}
              placeholder="e.g. acme-corp"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
            />
          </label>

          <label className="block text-xs text-slate-400">
            Account type
            <select
              value={accountType}
              onChange={(event) => setAccountType(event.target.value as "Organization" | "User")}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100"
            >
              <option value="Organization">Organization</option>
              <option value="User">User</option>
            </select>
          </label>

          {state.status === "error" && (
            <p className="text-xs text-rose-400">{state.message}</p>
          )}

          <p className="text-xs text-slate-500">
            Without real GitHub App credentials configured on the backend, the sync that follows
            uses clearly-labeled simulated repository/commit/PR data — see
            docs/DEVELOPMENT_STATUS.md.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={state.status === "submitting"}
              className="rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            >
              {state.status === "submitting" ? "Connecting…" : "Connect & sync"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
