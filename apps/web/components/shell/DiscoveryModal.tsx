"use client";

import { useEffect, useState } from "react";
import { infraApi, InfraApiError } from "@/lib/infra-api";
import type { DetectedLocalNetwork, DiscoveryCandidate, NetworkScanResult } from "@/lib/infra-discovery-types";

type Step = "detecting" | "confirm" | "scanning" | "results" | "error";

interface DiscoveryModalProps {
  environmentId: string;
  onClose: () => void;
  onImported: () => void;
}

export function DiscoveryModal({ environmentId, onClose, onImported }: DiscoveryModalProps) {
  const [step, setStep] = useState<Step>("detecting");
  const [local, setLocal] = useState<DetectedLocalNetwork | null>(null);
  const [cidr, setCidr] = useState("");
  const [result, setResult] = useState<NetworkScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());

  useEffect(() => {
    infraApi
      .detectLocalNetwork(environmentId)
      .then((detected) => {
        setLocal(detected);
        setCidr(detected.subnetCidr ?? "");
        setStep("confirm");
      })
      .catch((err) => {
        setError(err instanceof InfraApiError ? err.message : "Failed to detect local network");
        setStep("error");
      });
  }, [environmentId]);

  async function handleScan() {
    setStep("scanning");
    try {
      const scanResult = await infraApi.scanSubnet(environmentId, cidr);
      setResult(scanResult);
      setStep("results");
    } catch (err) {
      setError(err instanceof InfraApiError ? err.message : "Scan failed");
      setStep("error");
    }
  }

  async function handleImport(candidate: DiscoveryCandidate) {
    setImporting(candidate.ip);
    try {
      await infraApi.importCandidate(environmentId, {
        ...candidate,
        name: candidate.suggestedName,
        category: candidate.suggestedCategory,
      });
      setImported((prev) => new Set(prev).add(candidate.ip));
      onImported();
    } catch (err) {
      setError(err instanceof InfraApiError ? err.message : "Import failed");
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">
      <div className="max-h-[85vh] w-[36rem] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Discover My Network</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>

        {step === "detecting" && <p className="mt-4 text-sm text-slate-400">Detecting your local network…</p>}

        {step === "error" && (
          <div className="mt-4">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={onClose} className="mt-3 rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-200">Close</button>
          </div>
        )}

        {step === "confirm" && local && (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-slate-400">TRACE detected this network. Confirm the scope before scanning — it never scans anything outside this.</p>
            <dl className="rounded-md border border-slate-800 bg-slate-950 p-3 text-xs">
              <Row label="Interface" value={local.interfaceName} />
              <Row label="Local address" value={local.localAddress} />
              <Row label="Default gateway" value={local.gateway} />
            </dl>
            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-500">Subnet to scan</label>
              <input
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                placeholder="192.168.0.0/24"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
              />
            </div>
            <p className="text-xs text-slate-500">
              Discovery uses ARP/neighbor-table inspection and an optional nmap ping sweep — no port scanning, nothing outside this subnet.
            </p>
            <button
              onClick={handleScan}
              disabled={!cidr}
              className="w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Authorize and scan {cidr}
            </button>
          </div>
        )}

        {step === "scanning" && <p className="mt-4 text-sm text-slate-400">Scanning {cidr}…</p>}

        {step === "results" && result && (
          <div className="mt-4">
            <p className="text-xs text-slate-500">
              Found {result.candidates.length} host(s) at {new Date(result.scannedAt).toLocaleTimeString()}
              {!result.usedNmap && " (ARP only — nmap not installed, so unresponsive hosts may be missing)"}.
            </p>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            <ul className="mt-3 space-y-2">
              {result.candidates.map((c) => (
                <li key={c.ip} className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs">
                  <div>
                    <div className="font-medium text-slate-100">
                      {c.ip} {c.isGateway && <span className="ml-1 rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] text-amber-300">likely router</span>}
                    </div>
                    <div className="text-slate-500">
                      {c.mac ?? "no MAC"} {c.vendorGuess && `· possibly ${c.vendorGuess}`} · suggested: {c.suggestedCategory.replace(/_/g, " ")}
                    </div>
                  </div>
                  {c.alreadyKnown ? (
                    <span className="text-slate-500">In inventory ({c.existingDeviceName})</span>
                  ) : imported.has(c.ip) ? (
                    <span className="text-emerald-400">Imported</span>
                  ) : (
                    <button
                      onClick={() => handleImport(c)}
                      disabled={importing === c.ip}
                      className="rounded-md bg-sky-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      {importing === c.ip ? "Importing…" : "Import"}
                    </button>
                  )}
                </li>
              ))}
              {result.candidates.length === 0 && <p className="text-xs text-slate-500">No hosts found.</p>}
            </ul>
            <button onClick={onClose} className="mt-4 w-full rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value ?? "unknown"}</span>
    </div>
  );
}
