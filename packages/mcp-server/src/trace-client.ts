/**
 * The only thing this file does is call TRACE's own REST API — see
 * PRODUCT_SPEC.md section 11: "Do not build independent duplicate
 * management implementations inside the MCP server." Every operation
 * Claude can request goes through the exact same backend code path
 * (connectors, credential decryption, audit logging) as the browser
 * console. Claude never receives a credential — the API's own
 * responses never include one (see apps/api/src/infra/credentials).
 */
export class TraceClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TraceClientError";
  }
}

export interface TraceClientConfig {
  baseUrl: string;
  serviceToken: string;
}

export interface TraceDevice {
  id: string;
  name: string;
  category: string;
  ipAddresses: string[];
  managementProtocols: string[];
  enrollmentStatus: string;
  onlineState: string;
  capabilities: Array<{ protocol: string; capability: string }>;
  credentials: Array<{ id: string; protocol: string }>;
}

export class TraceClient {
  constructor(private readonly config: TraceClientConfig) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.serviceToken}`,
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ message: res.statusText }))) as { message?: string };
      throw new TraceClientError(res.status, body.message ?? res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  listEnvironments() {
    return this.request<unknown>("/infra/environments");
  }

  listDevices(environmentId: string) {
    return this.request<unknown>(`/infra/environments/${environmentId}/devices`);
  }

  getTopology(environmentId: string) {
    return this.request<unknown>(`/infra/environments/${environmentId}/topology`);
  }

  getDevice(environmentId: string, deviceId: string) {
    return this.request<TraceDevice>(`/infra/environments/${environmentId}/devices/${deviceId}`);
  }

  updateDevice(environmentId: string, deviceId: string, patch: Record<string, unknown>) {
    return this.request<TraceDevice>(`/infra/environments/${environmentId}/devices/${deviceId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  detectLocalNetwork(environmentId: string) {
    return this.request<unknown>(`/infra/environments/${environmentId}/discovery/local-network`);
  }

  scanNetwork(environmentId: string, cidr?: string) {
    return this.request<unknown>(`/infra/environments/${environmentId}/discovery/scan`, {
      method: "POST",
      body: JSON.stringify({ cidr }),
    });
  }

  checkHealth(environmentId: string, deviceId: string) {
    return this.request<unknown>(`/infra/environments/${environmentId}/devices/${deviceId}/check-health`, {
      method: "POST",
    });
  }

  getMetrics(environmentId: string, deviceId: string, kind?: string, sinceMinutes?: number) {
    const query = new URLSearchParams({
      ...(kind ? { kind } : {}),
      ...(sinceMinutes ? { sinceMinutes: String(sinceMinutes) } : {}),
    });
    return this.request<unknown>(`/infra/environments/${environmentId}/devices/${deviceId}/metrics?${query}`);
  }

  getLogs(environmentId: string, limit?: number) {
    return this.request<unknown>(`/infra/environments/${environmentId}/audit-log${limit ? `?limit=${limit}` : ""}`);
  }

  executeCommand(environmentId: string, deviceName: string, command: string, timeoutMs?: number) {
    return this.request<unknown>(`/infra/environments/${environmentId}/console/exec`, {
      method: "POST",
      body: JSON.stringify({ deviceName, command, timeoutMs }),
    });
  }

  executeGroupCommand(environmentId: string, deviceNames: string[], command: string, timeoutMs?: number, confirm?: boolean) {
    return this.request<unknown>(`/infra/environments/${environmentId}/console/exec-group`, {
      method: "POST",
      body: JSON.stringify({ deviceNames, command, timeoutMs, confirm }),
    });
  }

  performAction(environmentId: string, deviceId: string, action: string, confirm?: boolean, params?: Record<string, unknown>) {
    return this.request<unknown>(`/infra/environments/${environmentId}/devices/${deviceId}/actions`, {
      method: "POST",
      body: JSON.stringify({ action, confirm, params }),
    });
  }

  getOperationStatus(environmentId: string, runId: string) {
    return this.request<unknown>(`/infra/environments/${environmentId}/console/runs/${runId}`);
  }

  /** The read side of TRACE v0.4's approval gate — checks whether a
   * pending action this client proposed (via executeCommand/
   * executeGroupCommand/performAction) has been approved/rejected yet.
   * Never approves anything itself; see docs/ARCHITECTURE.md's "MCP
   * integration" section for why that split is enforced server-side,
   * not just by this client omitting the call. */
  getPendingActionStatus(environmentId: string, pendingActionId: string) {
    return this.request<unknown>(`/infra/environments/${environmentId}/ai/pending-actions/${pendingActionId}`);
  }

  /** Read-only by construction (see connector.types.ts's DiagnosticName)
   * — never routes through the approval queue, same as checkHealth. */
  runDiagnostic(environmentId: string, deviceId: string, name: string, params?: Record<string, unknown>) {
    return this.request<unknown>(`/infra/environments/${environmentId}/devices/${deviceId}/diagnostics`, {
      method: "POST",
      body: JSON.stringify({ name, params }),
    });
  }

  /** TRACE v0.5: proposes a temporary (max 5 minute) credential-
   * enrollment window for one device — this call never carries, and
   * the API never accepts from it, an actual secret. Like
   * executeCommand/performAction, this only creates a pending action;
   * a human approving it in TRACE's dashboard is what opens the window
   * and lets them type the credential directly into TRACE's own UI. */
  requestCredentialEnrollment(environmentId: string, deviceId: string, protocol: string, label?: string) {
    return this.request<unknown>(`/infra/environments/${environmentId}/devices/${deviceId}/credential-enrollment-sessions`, {
      method: "POST",
      body: JSON.stringify({ protocol, label }),
    });
  }

  /** Read-only — reports whether a human has approved/completed/
   * cancelled/let-expire the most recent enrollment window for this
   * device. Never returns a secret: the underlying row has no field
   * capable of carrying one (see apps/api's credential-enrollment
   * module). Safe to call freely, same as checkHealth. */
  getCredentialEnrollmentStatus(environmentId: string, deviceId: string) {
    return this.request<unknown>(`/infra/environments/${environmentId}/devices/${deviceId}/credential-enrollment-sessions/active`);
  }
}
