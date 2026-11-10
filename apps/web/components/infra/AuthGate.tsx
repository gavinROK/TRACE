"use client";

import { useEffect, useState, type ReactNode } from "react";
import { infraApi, InfraApiError } from "@/lib/infra-api";

type AuthState = "loading" | "needsSetup" | "needsLogin" | "authenticated" | "error";

export function AuthGate({ children }: { children: (actor: string, onLogout: () => void) => ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [actor, setActor] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    void checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const status = await infraApi.authStatus();
      if (status.needsSetup) {
        setState("needsSetup");
        return;
      }
      const me = await infraApi.me();
      setActor(me.actor);
      setState("authenticated");
    } catch (error) {
      if (error instanceof InfraApiError && error.status === 401) {
        setState("needsLogin");
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Could not reach TRACE API");
        setState("error");
      }
    }
  }

  async function handleLogout() {
    await infraApi.logout();
    setState("needsLogin");
  }

  if (state === "loading") {
    return <Centered>Connecting to TRACE…</Centered>;
  }

  if (state === "error") {
    return (
      <Centered>
        <div className="max-w-sm text-center text-sm text-red-300">
          Could not reach the TRACE API at{" "}
          <code className="text-slate-300">{process.env.NEXT_PUBLIC_TRACE_API_BASE_URL ?? "http://localhost:4000"}</code>.
          <div className="mt-2 text-slate-500">{errorMessage}</div>
        </div>
      </Centered>
    );
  }

  if (state === "needsSetup") {
    return (
      <Centered>
        <CredentialForm
          title="Set up TRACE"
          subtitle="This creates the one operator account for this deployment."
          submitLabel="Create account"
          onSubmit={async (email, password) => {
            await infraApi.setup(email, password);
            setActor(`user:${email}`);
            setState("authenticated");
          }}
        />
      </Centered>
    );
  }

  if (state === "needsLogin") {
    return (
      <Centered>
        <CredentialForm
          title="Sign in to TRACE"
          submitLabel="Sign in"
          onSubmit={async (email, password) => {
            await infraApi.login(email, password);
            await checkAuth();
          }}
        />
      </Centered>
    );
  }

  return <>{children(actor, handleLogout)}</>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">{children}</div>
  );
}

function CredentialForm({
  title,
  subtitle,
  submitLabel,
  onSubmit,
}: {
  title: string;
  subtitle?: string;
  submitLabel: string;
  onSubmit: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-80 rounded-xl border border-slate-700 bg-slate-900/95 p-6 shadow-2xl"
    >
      <h1 className="text-lg font-semibold text-slate-100">{title}</h1>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
      <label className="mt-4 block text-xs uppercase tracking-wide text-slate-500">Email</label>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
      />
      <label className="mt-3 block text-xs uppercase tracking-wide text-slate-500">Password</label>
      <input
        type="password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
      />
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="mt-5 w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {submitting ? "…" : submitLabel}
      </button>
    </form>
  );
}
