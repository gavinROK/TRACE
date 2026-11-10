/**
 * Client-side helper for calling the infra control plane directly
 * (unlike lib/trace-api.ts, which proxies the developer-intelligence
 * API through a server Route Handler with a secret bearer key). There
 * is no secret to protect here — the infra API authorizes every
 * request by cookie session (or the WebAuthn/password login that
 * issues one), so the browser can call it directly with
 * `credentials: "include"`.
 */
import type {
  InfraCommandRun,
  InfraDashboardSummary,
  InfraDeviceDetail,
  InfraDeviceSummary,
  InfraEnvironment,
  InfraMetricSample,
  InfraTopologySnapshot,
} from "./infra-types";

const BASE_URL = process.env.NEXT_PUBLIC_TRACE_API_BASE_URL ?? "http://localhost:4000";

export class InfraApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "InfraApiError";
  }
}

async function infraFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new InfraApiError(res.status, body.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const infraApi = {
  authStatus: () => infraFetch<{ needsSetup: boolean }>("/infra/auth/status"),
  me: () => infraFetch<{ actor: string }>("/infra/auth/me"),
  setup: (email: string, password: string) =>
    infraFetch<{ email: string }>("/infra/auth/setup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    infraFetch<{ ok: true }>("/infra/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => infraFetch<{ ok: true }>("/infra/auth/logout", { method: "POST" }),

  listEnvironments: () => infraFetch<InfraEnvironment[]>("/infra/environments"),
  createEnvironment: (name: string, slug: string, description?: string) =>
    infraFetch<InfraEnvironment>("/infra/environments", { method: "POST", body: JSON.stringify({ name, slug, description }) }),

  getTopology: (environmentId: string) => infraFetch<InfraTopologySnapshot>(`/infra/environments/${environmentId}/topology`),
  getDashboardSummary: (environmentId: string) =>
    infraFetch<InfraDashboardSummary>(`/infra/environments/${environmentId}/devices/summary`),

  listDevices: (environmentId: string) => infraFetch<InfraDeviceSummary[]>(`/infra/environments/${environmentId}/devices`),
  getDevice: (environmentId: string, deviceId: string) =>
    infraFetch<InfraDeviceDetail>(`/infra/environments/${environmentId}/devices/${deviceId}`),
  createDevice: (environmentId: string, dto: Record<string, unknown>) =>
    infraFetch<InfraDeviceSummary>(`/infra/environments/${environmentId}/devices`, { method: "POST", body: JSON.stringify(dto) }),
  checkDeviceHealth: (environmentId: string, deviceId: string) =>
    infraFetch<{ onlineState: string; checkedAt: string; detail?: string; metricsCollected: number }>(
      `/infra/environments/${environmentId}/devices/${deviceId}/check-health`,
      { method: "POST" },
    ),
  getDeviceMetricHistory: (environmentId: string, deviceId: string, kind?: string, sinceMinutes?: number) =>
    infraFetch<InfraMetricSample[]>(
      `/infra/environments/${environmentId}/devices/${deviceId}/metrics?${new URLSearchParams({
        ...(kind ? { kind } : {}),
        ...(sinceMinutes ? { sinceMinutes: String(sinceMinutes) } : {}),
      })}`,
    ),

  createCredential: (environmentId: string, dto: { label: string; protocol: string; deviceId?: string; payload: Record<string, unknown> }) =>
    infraFetch(`/infra/environments/${environmentId}/credentials`, { method: "POST", body: JSON.stringify(dto) }),

  execCommand: (environmentId: string, deviceName: string, command: string, timeoutMs?: number) =>
    infraFetch<InfraCommandRun>(`/infra/environments/${environmentId}/console/exec`, {
      method: "POST",
      body: JSON.stringify({ deviceName, command, timeoutMs }),
    }),
  listCommandRuns: (environmentId: string, limit?: number) =>
    infraFetch<InfraCommandRun[]>(`/infra/environments/${environmentId}/console/runs${limit ? `?limit=${limit}` : ""}`),

  performAction: (environmentId: string, deviceId: string, action: string, confirm = false, params?: Record<string, unknown>) =>
    infraFetch<{ success: boolean; detail?: string }>(`/infra/environments/${environmentId}/devices/${deviceId}/actions`, {
      method: "POST",
      body: JSON.stringify({ action, confirm, params }),
    }),

  discoverProxmox: (environmentId: string, hypervisorDeviceId: string) =>
    infraFetch<{ created: number; updated: number; totalDiscovered: number }>(
      `/infra/environments/${environmentId}/discovery/proxmox/${hypervisorDeviceId}`,
      { method: "POST" },
    ),
  listLocalInterfaces: (environmentId: string) =>
    infraFetch<Array<{ name: string; address: string; family: string; internal: boolean }>>(
      `/infra/environments/${environmentId}/discovery/interfaces`,
    ),
};
