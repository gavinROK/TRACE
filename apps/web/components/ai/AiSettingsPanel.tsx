"use client";

import { useCallback, useEffect, useState } from "react";
import { aiApi } from "@/lib/ai-api";
import { InfraApiError } from "@/lib/infra-api";
import type { AiModelInfo, AiSettingsStatus } from "@/lib/ai-types";

/**
 * The setup screen PRODUCT_SPEC v0.3 section 3 requires: "Provide a
 * setup screen where I can securely configure my own Anthropic API
 * key. Do not require me to paste credentials into chat." Embedded in
 * SettingsView, not a separate page — the key itself is never returned
 * by the backend once saved (see AiSettingsService.getStatus), so this
 * component only ever shows a masked "configured" state afterward.
 */
export function AiSettingsPanel() {
  const [status, setStatus] = useState<AiSettingsStatus | null>(null);
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    aiApi.getSettings().then(setStatus).catch((err) => setError(err instanceof Error ? err.message : "Failed to load AI settings"));
    aiApi.listModels().then(setModels).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSaveKey(event: React.FormEvent) {
    event.preventDefault();
    if (!apiKeyInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await aiApi.saveApiKey(apiKeyInput.trim());
      setApiKeyInput("");
      load();
    } catch (err) {
      setError(err instanceof InfraApiError ? err.message : "Failed to save API key");
    } finally {
      setSaving(false);
    }
  }

  async function handleClearKey() {
    if (!window.confirm("Remove the configured Anthropic API key? The AI assistant will stop working until a new one is added.")) return;
    await aiApi.clearApiKey();
    load();
  }

  async function handleSelectModel(modelId: string) {
    await aiApi.setModel(modelId);
    load();
  }

  if (!status) return <p className="mt-1 text-xs text-slate-500">Loading…</p>;

  return (
    <div className="space-y-3">
      {status.configured ? (
        <div className="rounded-md border border-slate-800 bg-slate-900 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-emerald-400">● Anthropic API key configured</span>
            <button onClick={handleClearKey} className="text-red-400 hover:text-red-300">
              Remove
            </button>
          </div>
          {status.updatedAt && <p className="mt-1 text-[11px] text-slate-500">Last saved {new Date(status.updatedAt).toLocaleString()}</p>}

          <div className="mt-3">
            <label className="block text-[10px] uppercase tracking-wide text-slate-500">Model</label>
            <select
              value={status.selectedModel ?? ""}
              onChange={(e) => handleSelectModel(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
            >
              {!status.selectedModel && <option value="">Default (claude-sonnet-5)</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                  {m.pricePerMillionInputTokens ? ` — $${m.pricePerMillionInputTokens}/$${m.pricePerMillionOutputTokens} per MTok in/out` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSaveKey} className="space-y-2 rounded-md border border-slate-800 bg-slate-900 p-3 text-xs">
          <p className="text-slate-400">
            TRACE&apos;s AI assistant needs your own Anthropic API key — a Claude.ai subscription does not include API access, these are
            billed and managed separately at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-sky-400 underline">
              console.anthropic.com
            </a>
            .
          </p>
          <label className="block text-[10px] uppercase tracking-wide text-slate-500">Anthropic API key</label>
          <input
            type="password"
            autoComplete="off"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 outline-none focus:border-sky-500"
          />
          <p className="text-[11px] text-slate-500">Stored encrypted on this machine (AES-256-GCM) — never sent to the browser again after this.</p>
          {error && <p className="text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={saving || !apiKeyInput.trim()}
            className="w-full rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save API key"}
          </button>
        </form>
      )}
    </div>
  );
}
