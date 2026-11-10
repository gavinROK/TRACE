"use client";

import { useMemo, useState } from "react";
import { infraApi, InfraApiError } from "@/lib/infra-api";
import type { InfraDeviceCategory, InfraDeviceSummary } from "@/lib/infra-types";

const CATEGORIES: InfraDeviceCategory[] = [
  "PHYSICAL_SERVER", "VIRTUAL_MACHINE", "CONTAINER", "ROUTER", "FIREWALL",
  "MANAGED_SWITCH", "NAS", "STORAGE_DEVICE", "PRINTER", "KVM", "WORKSTATION", "GENERIC_NETWORK_DEVICE",
];

const STATUS_COLOR: Record<string, string> = { ONLINE: "text-emerald-400", OFFLINE: "text-red-400", UNKNOWN: "text-slate-500" };

interface DevicesViewProps {
  environmentId: string;
  devices: InfraDeviceSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}

export function DevicesView({ environmentId, devices, selectedId, onSelect, onChanged }: DevicesViewProps) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return devices;
    return devices.filter((d) => d.name.toLowerCase().includes(query) || d.category.toLowerCase().includes(query));
  }, [devices, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search devices…"
          className="w-56 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
        />
        <button
          onClick={() => setAdding(true)}
          className="ml-auto rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
        >
          + Add device
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-950 text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Address</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Enrollment</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr
                key={d.id}
                onClick={() => onSelect(d.id)}
                className={`cursor-pointer border-t border-slate-900 hover:bg-slate-900 ${selectedId === d.id ? "bg-slate-900" : ""}`}
              >
                <td className="px-4 py-2 text-slate-100">{d.name}</td>
                <td className="px-4 py-2 text-slate-400">{d.category.replace(/_/g, " ")}</td>
                <td className="px-4 py-2 text-slate-400">{d.ipAddresses[0] ?? <span className="text-amber-500">missing</span>}</td>
                <td className={`px-4 py-2 font-medium ${STATUS_COLOR[d.onlineState]}`}>{d.onlineState}</td>
                <td className="px-4 py-2 text-slate-400">{d.enrollmentStatus}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No devices match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddDeviceModal
          environmentId={environmentId}
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            onChanged();
            onSelect(id);
          }}
        />
      )}
    </div>
  );
}

function AddDeviceModal({
  environmentId,
  onClose,
  onCreated,
}: {
  environmentId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<InfraDeviceCategory>("PHYSICAL_SERVER");
  const [ip, setIp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const device = await infraApi.createDevice(environmentId, {
        name,
        category,
        ipAddresses: ip ? [ip] : [],
      });
      onCreated(device.id);
    } catch (err) {
      setError(err instanceof InfraApiError ? err.message : "Failed to create device");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">
      <form onSubmit={handleSubmit} className="w-80 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-slate-100">Add device</h2>
        <label className="mt-3 block text-xs uppercase tracking-wide text-slate-500">Name</label>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        <label className="mt-3 block text-xs uppercase tracking-wide text-slate-500">Type</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as InfraDeviceCategory)}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
        <label className="mt-3 block text-xs uppercase tracking-wide text-slate-500">Management IP (optional)</label>
        <input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="192.168.0.x"
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? "…" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}
