"use client";

import { useCallback, useEffect, useState } from "react";
import { infraApi, InfraApiError } from "@/lib/infra-api";
import type { CredentialEnrollmentSessionSummary, InfraDeviceCategory, InfraDeviceDetail, InfraManagementProtocol } from "@/lib/infra-types";

const CATEGORIES: InfraDeviceCategory[] = [
  "PHYSICAL_SERVER", "VIRTUAL_MACHINE", "CONTAINER", "ROUTER", "FIREWALL",
  "MANAGED_SWITCH", "NAS", "STORAGE_DEVICE", "PRINTER", "KVM", "WORKSTATION", "GENERIC_NETWORK_DEVICE",
];
const PROTOCOLS: InfraManagementProtocol[] = ["SSH", "PROXMOX_API", "SNMP_V3", "VENDOR_API", "WINDOWS_WINRM", "DOCKER_API"];

const STATUS_COLOR: Record<string, string> = { ONLINE: "text-emerald-400", OFFLINE: "text-red-400", UNKNOWN: "text-slate-500" };

interface DeviceRightPanelProps {
  environmentId: string;
  deviceId: string;
  onClose: () => void;
  onOpenConsole: (deviceName: string) => void;
  onChanged: () => void;
}

export function DeviceRightPanel({ environmentId, deviceId, onClose, onOpenConsole, onChanged }: DeviceRightPanelProps) {
  const [device, setDevice] = useState<InfraDeviceDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [enrollmentSession, setEnrollmentSession] = useState<CredentialEnrollmentSessionSummary | null>(null);

  const load = useCallback(() => {
    return infraApi
      .getDevice(environmentId, deviceId)
      .then(setDevice)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load device"));
  }, [environmentId, deviceId]);

  const loadEnrollmentSession = useCallback(() => {
    return infraApi.getActiveCredentialEnrollmentSession(environmentId, deviceId).then(setEnrollmentSession);
  }, [environmentId, deviceId]);

  useEffect(() => {
    load();
    loadEnrollmentSession();
  }, [load, loadEnrollmentSession]);

  // While a window is open (AUTHORIZED), poll so the countdown and
  // "has the human finished yet" status stay live without a manual
  // refresh — this is also how an operator notices the window expired
  // out from under them. Stops polling once the session leaves
  // AUTHORIZED (completed/expired/revoked), so this never runs forever.
  useEffect(() => {
    if (enrollmentSession?.status !== "AUTHORIZED") return;
    const interval = setInterval(loadEnrollmentSession, 5_000);
    return () => clearInterval(interval);
  }, [enrollmentSession?.status, loadEnrollmentSession]);

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await infraApi.checkDeviceHealth(environmentId, deviceId);
      setTestResult(
        `${result.onlineState} at ${new Date(result.checkedAt).toLocaleTimeString()}${result.detail ? ` — ${result.detail}` : ""}`,
      );
      await load();
      onChanged();
    } catch (err) {
      setTestResult(err instanceof InfraApiError ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    if (!device) return;
    if (!window.confirm(`Delete "${device.name}" from TRACE's inventory? This only removes the record — it does not touch the real device.`)) return;
    await infraApi.deleteDevice(environmentId, deviceId);
    onChanged();
    onClose();
  }

  if (error) return <Panel onClose={onClose}>{error}</Panel>;
  if (!device) return <Panel onClose={onClose}>Loading…</Panel>;

  return (
    <Panel onClose={onClose}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{device.category.replace(/_/g, " ")}</div>
          <h2 className="text-lg font-semibold text-slate-100">{device.name}</h2>
        </div>
        <span className={`text-xs font-medium ${STATUS_COLOR[device.onlineState]}`}>{device.onlineState}</span>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => setEditing((v) => !v)}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
        >
          {editing ? "Cancel edit" : "Edit settings"}
        </button>
        <button
          onClick={handleTestConnection}
          disabled={testing}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        {device.managementProtocols.includes("SSH") && (
          <button
            onClick={() => onOpenConsole(device.name)}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          >
            Console
          </button>
        )}
      </div>
      {testResult && <p className="mt-2 text-xs text-slate-400">{testResult}</p>}

      {editing ? (
        <DeviceEditForm
          environmentId={environmentId}
          device={device}
          onSaved={() => {
            setEditing(false);
            load();
            onChanged();
          }}
        />
      ) : (
        <DeviceReadOnlyView device={device} />
      )}

      <CredentialsSection
        environmentId={environmentId}
        deviceId={deviceId}
        credentials={device.credentials}
        enrollmentSession={enrollmentSession}
        onChanged={() => {
          load();
          loadEnrollmentSession();
        }}
      />

      <div className="mt-5 border-t border-slate-800 pt-3">
        <button onClick={handleDelete} className="text-xs text-red-400 hover:text-red-300">
          Delete from inventory
        </button>
      </div>
    </Panel>
  );
}

function DeviceReadOnlyView({ device }: { device: InfraDeviceDetail }) {
  return (
    <>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Field label="Manufacturer" value={device.manufacturer} />
        <Field label="Model" value={device.model} />
        <Field label="OS" value={device.operatingSystem} />
        <Field label="OS version" value={device.osVersion} />
        <Field label="IP" value={device.ipAddresses.join(", ") || null} />
        <Field label="Port" value={device.managementPort ? String(device.managementPort) : null} />
        <Field label="Protocols" value={device.managementProtocols.join(", ") || null} />
        <Field label="Tags" value={device.tags.join(", ") || null} />
        <Field label="Enrollment" value={device.enrollmentStatus} />
        <Field label="Discovered via" value={device.discoverySource} />
        <Field label="Last contact" value={device.lastContactAt ? new Date(device.lastContactAt).toLocaleString() : null} />
        {device.parentDevice && <Field label="Hosted on" value={device.parentDevice.name} />}
      </dl>

      <div className="mt-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Capabilities</div>
        {device.capabilities.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">
            None yet — add a management IP and a credential below to unlock health checks, metrics, or the console.
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
                <span className="text-slate-400">{m.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} {m.unit}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function DeviceEditForm({
  environmentId,
  device,
  onSaved,
}: {
  environmentId: string;
  device: InfraDeviceDetail;
  onSaved: () => void;
}) {
  const [name, setName] = useState(device.name);
  const [category, setCategory] = useState(device.category);
  const [manufacturer, setManufacturer] = useState(device.manufacturer ?? "");
  const [model, setModel] = useState(device.model ?? "");
  const [ip, setIp] = useState(device.ipAddresses.join(", "));
  const [mac, setMac] = useState(device.macAddresses.join(", "));
  const [port, setPort] = useState(device.managementPort ? String(device.managementPort) : "");
  const [protocols, setProtocols] = useState<Set<InfraManagementProtocol>>(new Set(device.managementProtocols));
  const [tags, setTags] = useState(device.tags.join(", "));
  const [notes, setNotes] = useState(device.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleProtocol(p: InfraManagementProtocol) {
    setProtocols((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await infraApi.updateDevice(environmentId, device.id, {
        name,
        category,
        manufacturer: manufacturer || undefined,
        model: model || undefined,
        ipAddresses: splitList(ip),
        macAddresses: splitList(mac),
        managementPort: port ? Number(port) : undefined,
        managementProtocols: [...protocols],
        tags: splitList(tags),
        notes: notes || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof InfraApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
      <LabeledInput label="Display name" value={name} onChange={setName} />
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-slate-500">Device type</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as InfraDeviceCategory)}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>
      <LabeledInput label="Manufacturer" value={manufacturer} onChange={setManufacturer} />
      <LabeledInput label="Model" value={model} onChange={setModel} />
      <LabeledInput label="Management IP / hostname(s) — comma separated" value={ip} onChange={setIp} placeholder="192.168.0.70" />
      <LabeledInput label="MAC address(es) — comma separated" value={mac} onChange={setMac} />
      <LabeledInput label="Management port" value={port} onChange={setPort} placeholder="e.g. 22, 8006, 161" />
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-slate-500">Management protocols</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {PROTOCOLS.map((p) => (
            <label key={p} className="flex items-center gap-1 text-slate-300">
              <input type="checkbox" checked={protocols.has(p)} onChange={() => toggleProtocol(p)} />
              {p}
            </label>
          ))}
        </div>
      </div>
      <LabeledInput label="Tags — comma separated" value={tags} onChange={setTags} />
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-slate-500">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
        />
      </div>
      {error && <p className="text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save configuration"}
      </button>
      <p className="text-[10px] text-slate-500">
        Changing the address here changes what TRACE connects to — it never reconfigures the real device.
      </p>
    </form>
  );
}

function CredentialsSection({
  environmentId,
  deviceId,
  credentials,
  enrollmentSession,
  onChanged,
}: {
  environmentId: string;
  deviceId: string;
  credentials: InfraDeviceDetail["credentials"];
  enrollmentSession: CredentialEnrollmentSessionSummary | null;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  async function handleRemove(credentialId: string) {
    await infraApi.deleteCredential(environmentId, credentialId);
    onChanged();
  }

  const activeSession = enrollmentSession?.status === "AUTHORIZED" ? enrollmentSession : null;

  return (
    <div className="mt-5 border-t border-slate-800 pt-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500">Credentials</div>
        <button onClick={() => setAdding((v) => !v)} className="text-xs text-sky-400 hover:text-sky-300">
          {adding ? "Cancel" : "+ Add credential"}
        </button>
      </div>
      {credentials.length === 0 && !adding && <p className="mt-1 text-xs text-slate-500">None enrolled.</p>}
      <ul className="mt-1 space-y-1">
        {credentials.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-xs text-slate-300">
            <span>{c.label} <span className="text-slate-500">({c.protocol})</span></span>
            <button onClick={() => handleRemove(c.id)} className="text-red-400 hover:text-red-300">
              Remove
            </button>
          </li>
        ))}
      </ul>

      {activeSession && (
        <EnrollmentSessionPanel
          environmentId={environmentId}
          session={activeSession}
          onCompleted={onChanged}
          onCancelled={onChanged}
        />
      )}

      {adding && (
        <CredentialForm
          environmentId={environmentId}
          deviceId={deviceId}
          onSaved={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** TRACE v0.5: shown only while a human-approved, time-boxed enrollment
 * window is open. The protocol is fixed to whatever the approver
 * authorized — never re-selectable here — so this form cannot attach
 * the credential to a protocol nobody approved. Submitting calls
 * `completeCredentialEnrollmentSession`, the one route that can turn
 * this window into a real `InfraCredential`; it is also the only place
 * in this whole flow a secret value exists in the browser's memory at
 * all, and it goes straight from here to TRACE's own API, never
 * through Claude or MCP. */
function EnrollmentSessionPanel({
  environmentId,
  session,
  onCompleted,
  onCancelled,
}: {
  environmentId: string;
  session: CredentialEnrollmentSessionSummary;
  onCompleted: () => void;
  onCancelled: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const minutes = Math.floor(session.secondsRemaining / 60);
  const seconds = String(session.secondsRemaining % 60).padStart(2, "0");

  async function handleCancel() {
    setCancelling(true);
    try {
      await infraApi.cancelCredentialEnrollmentSession(environmentId, session.id);
      onCancelled();
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-amber-700/50 bg-amber-950/30 p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="font-medium text-amber-300">
          Claude requested a {session.protocol} credential{session.label ? ` ("${session.label}")` : ""}
        </div>
        <span className="font-mono text-amber-400">{minutes}:{seconds}</span>
      </div>
      <p className="mt-1 text-slate-400">
        Approved just now — type the value below before this window closes. It is never sent to Claude.
      </p>
      <CredentialForm
        environmentId={environmentId}
        deviceId={session.deviceId}
        lockedProtocol={session.protocol}
        defaultLabel={session.label ?? ""}
        onSaved={onCompleted}
        onSubmitCredential={(dto) => infraApi.completeCredentialEnrollmentSession(environmentId, session.id, dto)}
      />
      <button
        onClick={handleCancel}
        disabled={cancelling}
        className="mt-2 text-amber-400 hover:text-amber-300 disabled:opacity-50"
      >
        {cancelling ? "Cancelling…" : "Cancel this window"}
      </button>
    </div>
  );
}

function CredentialForm({
  environmentId,
  deviceId,
  lockedProtocol,
  defaultLabel,
  onSaved,
  onSubmitCredential,
}: {
  environmentId: string;
  deviceId: string;
  /** When set, this form was opened from an authorized enrollment
   * session — the protocol is fixed to what was approved and cannot
   * be changed here. */
  lockedProtocol?: InfraManagementProtocol;
  defaultLabel?: string;
  onSaved: () => void;
  /** Overrides where the credential is actually written — used by
   * `EnrollmentSessionPanel` to call `completeCredentialEnrollmentSession`
   * instead of `createCredential`. Defaults to the normal manual-add path. */
  onSubmitCredential?: (dto: { label: string; payload: Record<string, unknown> }) => Promise<unknown>;
}) {
  const [label, setLabel] = useState(defaultLabel ?? "");
  const [protocol, setProtocol] = useState<InfraManagementProtocol>(lockedProtocol ?? "SSH");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [allowSelfSigned, setAllowSelfSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...fields };
      if (protocol === "PROXMOX_API") payload.allowSelfSigned = allowSelfSigned;
      if (onSubmitCredential) {
        await onSubmitCredential({ label, payload });
      } else {
        await infraApi.createCredential(environmentId, { label, protocol, deviceId, payload });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof InfraApiError ? err.message : "Failed to save credential");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2 rounded-md border border-slate-800 bg-slate-950 p-3 text-xs">
      <LabeledInput label="Label" value={label} onChange={setLabel} placeholder="e.g. beelink-ssh" />
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-slate-500">Protocol</label>
        {lockedProtocol ? (
          <p className="mt-1 text-slate-300">{lockedProtocol} <span className="text-slate-500">(set by the approved request — fixed)</span></p>
        ) : (
          <select
            value={protocol}
            onChange={(e) => { setProtocol(e.target.value as InfraManagementProtocol); setFields({}); }}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100"
          >
            <option value="SSH">SSH</option>
            <option value="PROXMOX_API">Proxmox API</option>
            <option value="SNMP_V3">SNMPv3</option>
          </select>
        )}
      </div>

      {protocol === "SSH" && (
        <>
          <LabeledInput label="Username" value={fields.username ?? ""} onChange={(v) => setField("username", v)} />
          <LabeledInput label="Password" value={fields.password ?? ""} onChange={(v) => setField("password", v)} type="password" />
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500">Private key (alternative to password)</label>
            <textarea
              value={fields.privateKey ?? ""}
              onChange={(e) => setField("privateKey", e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-[10px] text-slate-100"
            />
          </div>
        </>
      )}

      {protocol === "PROXMOX_API" && (
        <>
          <p className="text-slate-500">Use an API token (recommended) or username/password.</p>
          <LabeledInput label="Token user (e.g. root@pam)" value={fields.tokenUser ?? ""} onChange={(v) => setField("tokenUser", v)} />
          <LabeledInput label="Token ID" value={fields.tokenId ?? ""} onChange={(v) => setField("tokenId", v)} />
          <LabeledInput label="Token secret" value={fields.tokenSecret ?? ""} onChange={(v) => setField("tokenSecret", v)} type="password" />
          <p className="text-slate-500">— or —</p>
          <LabeledInput label="Username (e.g. root@pam)" value={fields.username ?? ""} onChange={(v) => setField("username", v)} />
          <LabeledInput label="Password" value={fields.password ?? ""} onChange={(v) => setField("password", v)} type="password" />
          <label className="flex items-center gap-2 text-amber-400">
            <input type="checkbox" checked={allowSelfSigned} onChange={(e) => setAllowSelfSigned(e.target.checked)} />
            Allow self-signed certificate (development only — TLS verification is otherwise required)
          </label>
        </>
      )}

      {protocol === "SNMP_V3" && (
        <>
          <LabeledInput label="Username" value={fields.username ?? ""} onChange={(v) => setField("username", v)} />
          <LabeledInput label="Auth key" value={fields.authKey ?? ""} onChange={(v) => setField("authKey", v)} type="password" />
          <LabeledInput label="Priv key (optional)" value={fields.privKey ?? ""} onChange={(v) => setField("privKey", v)} type="password" />
        </>
      )}

      {error && <p className="text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save credential"}
      </button>
    </form>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-slate-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 outline-none focus:border-sky-500"
      />
    </div>
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
    <aside className="relative h-full w-96 shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900 p-4">
      <button onClick={onClose} className="absolute right-3 top-3 text-slate-500 hover:text-slate-300" aria-label="Close">
        ✕
      </button>
      {children}
    </aside>
  );
}

function splitList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
