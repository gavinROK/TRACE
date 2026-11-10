"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import type { BackendMode } from "@/lib/useGraphData";
import type { DeviceEntity } from "@/lib/types";
import { formatPostureFlag } from "@/lib/device";
import { parseSimpleCsv } from "@/lib/csv";

interface DeviceProfilePanelProps {
  entity: DeviceEntity;
  mode: BackendMode;
  onClose: () => void;
  onDataChanged?: () => void;
}

type SubmitState = { status: "idle" | "submitting" } | { status: "error"; message: string };

const POSTURE_STATUS_CLASS: Record<string, string> = {
  HEALTHY: "text-emerald-400",
  AT_RISK: "text-amber-400",
  CRITICAL: "text-rose-400",
  UNKNOWN: "text-slate-500",
};

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
    </div>
  );
}

/** CSV rows are matched to SoftwareItemDto fields by header name, case-insensitively. */
function csvRowToSoftwareItem(row: Record<string, string>): { name: string; version?: string; publisher?: string; installedAt?: string } | null {
  const lookup = (key: string) => {
    const match = Object.keys(row).find((header) => header.toLowerCase() === key);
    return match ? row[match].trim() : "";
  };
  const name = lookup("name");
  if (!name) return null;
  const version = lookup("version");
  const publisher = lookup("publisher");
  const installedAt = lookup("installedat") || lookup("installed_at") || lookup("installed date");
  return {
    name,
    version: version || undefined,
    publisher: publisher || undefined,
    installedAt: installedAt || undefined,
  };
}

export function DeviceProfilePanel({ entity, mode, onClose, onDataChanged }: DeviceProfilePanelProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [publisher, setPublisher] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [addState, setAddState] = useState<SubmitState>({ status: "idle" });
  const [importState, setImportState] = useState<SubmitState>({ status: "idle" });

  const canManage = mode === "live";

  const postSoftware = async (
    source: "MANUAL" | "CSV_IMPORT",
    items: Array<{ name: string; version?: string; publisher?: string; installedAt?: string }>,
  ) => {
    const response = await fetch(`/api/trace/devices/${entity.id}/software`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, items }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? `Request failed (${response.status})`);
    }
    onDataChanged?.();
  };

  const handleAddSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setAddState({ status: "submitting" });
    try {
      await postSoftware("MANUAL", [
        {
          name,
          version: version || undefined,
          publisher: publisher || undefined,
          installedAt: installedAt || undefined,
        },
      ]);
      setName("");
      setVersion("");
      setPublisher("");
      setInstalledAt("");
      setShowAddForm(false);
      setAddState({ status: "idle" });
    } catch (error) {
      setAddState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to add software",
      });
    }
  };

  const handleCsvSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImportState({ status: "submitting" });
    try {
      const text = await file.text();
      const rows = parseSimpleCsv(text);
      const items = rows
        .map(csvRowToSoftwareItem)
        .filter((item): item is NonNullable<ReturnType<typeof csvRowToSoftwareItem>> => item !== null);
      if (items.length === 0) {
        throw new Error('No valid rows found — the CSV needs at least a "name" column.');
      }
      await postSoftware("CSV_IMPORT", items);
      setImportState({ status: "idle" });
    } catch (error) {
      setImportState({
        status: "error",
        message: error instanceof Error ? error.message : "CSV import failed",
      });
    }
  };

  return (
    <aside
      data-testid="device-profile-panel"
      className="absolute right-4 top-4 z-10 w-96 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">device</div>
          <h2 className="text-lg font-semibold text-slate-100">{entity.label}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 space-y-2 text-sm text-slate-300">
        <Field label="Owner" value={entity.ownerName ?? "Unassigned"} />
        <Field label="Department" value={entity.departmentName ?? "Unassigned"} />
        <Field label="Type" value={entity.deviceType} />
        <Field label="Operating system" value={`${entity.operatingSystem} ${entity.osVersion}`} />
        <Field label="Serial number" value={entity.serialNumber ?? "—"} />
        <Field label="Enrollment" value={entity.enrollmentType} />
        <Field
          label="Last check-in"
          value={entity.lastCheckInAt ? new Date(entity.lastCheckInAt).toLocaleString() : "Never / unknown"}
        />

        <div
          data-testid="device-posture-status"
          className={`pt-1 text-xs font-semibold uppercase tracking-wide ${POSTURE_STATUS_CLASS[entity.posture.status]}`}
        >
          Security posture — {entity.posture.status.replace("_", " ")}
        </div>
        <Field label="Disk encryption" value={formatPostureFlag(entity.posture.diskEncrypted)} />
        <Field label="Firewall" value={formatPostureFlag(entity.posture.firewallEnabled)} />
        <Field label="OS up to date" value={formatPostureFlag(entity.posture.osUpToDate)} />
        <Field label="Screen lock" value={formatPostureFlag(entity.posture.screenLockEnabled)} />
      </div>

      <div className="mt-4 border-t border-slate-800 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Installed software ({entity.software.length})
          </span>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              {showAddForm ? "Cancel" : "+ Add"}
            </button>
          )}
        </div>

        {entity.software.length === 0 && (
          <p className="text-sm text-slate-500">No software recorded for this device yet.</p>
        )}
        <ul className="space-y-1.5 text-sm text-slate-300">
          {entity.software.map((item) => (
            <li
              key={item.id}
              data-testid={`device-software-${item.id}`}
              className="rounded-md border border-slate-800 bg-slate-950/40 px-2.5 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-100">{item.name}</span>
                <span className="text-xs text-slate-500">{item.version ?? "—"}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>{item.publisher ?? "Unknown publisher"}</span>
                <span>{item.source === "CSV_IMPORT" ? "CSV import" : "Manual"}</span>
              </div>
            </li>
          ))}
        </ul>

        {!canManage && (
          <p className="mt-2 text-xs text-slate-500">
            Demo mode — software management requires a live backend.
          </p>
        )}

        {canManage && showAddForm && (
          <form
            data-testid="add-software-form"
            onSubmit={handleAddSubmit}
            className="mt-3 space-y-2 rounded-md border border-slate-800 bg-slate-950/40 p-3"
          >
            <label className="block text-xs text-slate-400">
              Name
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Visual Studio Code"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600"
              />
            </label>
            <div className="flex gap-2">
              <label className="block flex-1 text-xs text-slate-400">
                Version
                <input
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                />
              </label>
              <label className="block flex-1 text-xs text-slate-400">
                Publisher
                <input
                  value={publisher}
                  onChange={(event) => setPublisher(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                />
              </label>
            </div>
            <label className="block text-xs text-slate-400">
              Installed on
              <input
                type="date"
                value={installedAt}
                onChange={(event) => setInstalledAt(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
              />
            </label>
            {addState.status === "error" && (
              <p className="text-xs text-rose-400">{addState.message}</p>
            )}
            <button
              type="submit"
              disabled={addState.status === "submitting"}
              className="w-full rounded-md bg-cyan-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            >
              {addState.status === "submitting" ? "Adding…" : "Add software"}
            </button>
          </form>
        )}

        {canManage && (
          <div className="mt-3">
            <label className="block text-xs text-slate-400">
              Import from CSV (columns: name, version, publisher, installedAt)
              <input
                type="file"
                accept=".csv,text/csv"
                data-testid="software-csv-input"
                onChange={handleCsvSelected}
                className="mt-1 block w-full text-xs text-slate-400"
              />
            </label>
            {importState.status === "submitting" && (
              <p className="mt-1 text-xs text-slate-500">Importing…</p>
            )}
            {importState.status === "error" && (
              <p className="mt-1 text-xs text-rose-400">{importState.message}</p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
