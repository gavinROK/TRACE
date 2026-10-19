"use client";

import { useState, type FormEvent } from "react";

interface DeveloperOption {
  id: string;
  name: string;
}

interface EnrollDeviceModalProps {
  developers: DeveloperOption[];
  onClose: () => void;
  /** Called after a successful enrollment, so the graph can refetch. */
  onEnrolled: () => void;
}

type SubmitState = { status: "idle" | "submitting" } | { status: "error"; message: string };
type TriState = "unknown" | "yes" | "no";

function toBoolean(value: TriState): boolean | undefined {
  if (value === "unknown") return undefined;
  return value === "yes";
}

function PostureSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TriState;
  onChange: (value: TriState) => void;
}) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as TriState)}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100"
      >
        <option value="unknown">Unknown / not checked</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

export function EnrollDeviceModal({ developers, onClose, onEnrolled }: EnrollDeviceModalProps) {
  const [name, setName] = useState("");
  const [deviceType, setDeviceType] = useState("LAPTOP");
  const [operatingSystem, setOperatingSystem] = useState("");
  const [osVersion, setOsVersion] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [diskEncrypted, setDiskEncrypted] = useState<TriState>("unknown");
  const [firewallEnabled, setFirewallEnabled] = useState<TriState>("unknown");
  const [osUpToDate, setOsUpToDate] = useState<TriState>("unknown");
  const [screenLockEnabled, setScreenLockEnabled] = useState<TriState>("unknown");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setState({ status: "submitting" });

    try {
      const response = await fetch("/api/trace/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          deviceType,
          operatingSystem,
          osVersion,
          ownerId: ownerId || undefined,
          diskEncrypted: toBoolean(diskEncrypted),
          firewallEnabled: toBoolean(firewallEnabled),
          osUpToDate: toBoolean(osUpToDate),
          screenLockEnabled: toBoolean(screenLockEnabled),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? `Enrollment failed (${response.status})`);
      }

      onEnrolled();
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
        data-testid="enroll-device-modal"
        onClick={(event) => event.stopPropagation()}
        className="w-[26rem] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-100">Enroll Device</h2>
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
          Manual enrollment — enter what you know about the device now. Posture checks left as
          &quot;Unknown&quot; are recorded as genuinely unknown, not as a failing check; a future
          endpoint agent (not implemented yet) would report these automatically instead.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block text-xs text-slate-400">
            Device name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Jordan's MacBook Pro"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
            />
          </label>

          <label className="block text-xs text-slate-400">
            Device type
            <select
              value={deviceType}
              onChange={(event) => setDeviceType(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100"
            >
              <option value="LAPTOP">Laptop</option>
              <option value="DESKTOP">Desktop</option>
              <option value="MOBILE">Mobile</option>
              <option value="SERVER">Server</option>
              <option value="OTHER">Other</option>
            </select>
          </label>

          <div className="flex gap-3">
            <label className="block flex-1 text-xs text-slate-400">
              Operating system
              <input
                required
                value={operatingSystem}
                onChange={(event) => setOperatingSystem(event.target.value)}
                placeholder="e.g. macOS"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
              />
            </label>
            <label className="block flex-1 text-xs text-slate-400">
              Version
              <input
                required
                value={osVersion}
                onChange={(event) => setOsVersion(event.target.value)}
                placeholder="e.g. 15.1"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
              />
            </label>
          </div>

          <label className="block text-xs text-slate-400">
            Owner (optional — leave unset for shared/unowned devices)
            <select
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100"
            >
              <option value="">Unassigned</option>
              {developers.map((developer) => (
                <option key={developer.id} value={developer.id}>
                  {developer.name}
                </option>
              ))}
            </select>
          </label>

          <div className="pt-1 text-xs uppercase tracking-wide text-slate-500">
            Security posture
          </div>
          <PostureSelect label="Disk encryption" value={diskEncrypted} onChange={setDiskEncrypted} />
          <PostureSelect label="Firewall" value={firewallEnabled} onChange={setFirewallEnabled} />
          <PostureSelect label="OS up to date" value={osUpToDate} onChange={setOsUpToDate} />
          <PostureSelect label="Screen lock" value={screenLockEnabled} onChange={setScreenLockEnabled} />

          {state.status === "error" && <p className="text-xs text-rose-400">{state.message}</p>}

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
              {state.status === "submitting" ? "Enrolling…" : "Enroll device"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
