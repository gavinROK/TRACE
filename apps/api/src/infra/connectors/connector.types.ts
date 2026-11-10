import type {
  InfraManagementProtocol,
  InfraMetricKind,
  InfraOnlineState,
} from "@prisma/client";

/**
 * The connector interface from PRODUCT_SPEC.md section 10. A connector
 * only implements the methods its protocol actually supports — optional
 * methods being absent is how the rest of the backend (and ultimately the
 * frontend) knows not to offer a capability a device doesn't have. No
 * connector may claim a capability it cannot really perform.
 */
export interface InfraConnector {
  readonly protocol: InfraManagementProtocol;
  getCapabilities(): ConnectorCapability[];
  getHealth(target: ConnectorTarget): Promise<HealthResult>;
  getMetrics?(target: ConnectorTarget): Promise<MetricReading[]>;
  getConfiguration?(target: ConnectorTarget): Promise<Record<string, unknown>>;
  executeCommand?(
    target: ConnectorTarget,
    command: string,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<CommandResult>;
  performAction?(
    target: ConnectorTarget,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<ActionResult>;
  discover?(target: ConnectorTarget): Promise<DiscoveredAsset[]>;
  /** A curated, read-only inspection — unlike `executeCommand`, the
   * connector (not the caller) owns the exact command for each `name`,
   * so this can never be used to run arbitrary attacker-supplied shell
   * text. Every diagnostic is safe to run without approval; see
   * `DiagnosticName` for the fixed catalog a connector may support. */
  runDiagnostic?(
    target: ConnectorTarget,
    name: DiagnosticName,
    params?: Record<string, unknown>,
  ): Promise<DiagnosticResult>;
}

export type ConnectorCapability =
  | "discover"
  | "getHealth"
  | "getMetrics"
  | "getConfiguration"
  | "executeCommand"
  | "performAction"
  | "runDiagnostic";

/** The fixed, cross-protocol diagnostic catalog. Not every connector
 * implements every name — `getSupportedDiagnostics()` on a connector
 * (or, for SSH, `SSH_DIAGNOSTIC_NAMES`) says which. Adding a new
 * diagnostic means adding a name here plus one connector-side handler,
 * never a new MCP tool or approval path — every one of these is
 * read-only by construction. */
export type DiagnosticName =
  | "os_info"
  | "cpu_memory_disk"
  | "network_interfaces"
  | "service_status"
  | "system_logs"
  | "process_list"
  | "package_inventory"
  | "firewall_rules"
  | "filesystem_info"
  | "security_posture";

export interface SecurityFinding {
  severity: "info" | "low" | "medium" | "high";
  check: string;
  detail: string;
}

export interface DiagnosticResult {
  name: DiagnosticName;
  collectedAt: Date;
  /** Raw command output for a simple inspection; present for every
   * diagnostic except `security_posture`, which is summarized instead. */
  output?: string;
  /** Only for `security_posture` — structured findings rather than a
   * raw text dump, since the whole point is a scannable assessment. */
  findings?: SecurityFinding[];
  truncated?: boolean;
}

/** A credential payload decrypted just-in-time for one connector call —
 * never logged, never persisted outside InfraCredential's ciphertext. */
export interface ConnectorCredential {
  protocol: InfraManagementProtocol;
  payload: Record<string, unknown>;
}

export interface ConnectorTarget {
  deviceId: string;
  /** Hostname or IP the connector should actually dial. */
  host: string;
  /** Protocol-specific extra addressing, e.g. a Proxmox node name + vmid. */
  metadata?: Record<string, unknown>;
  credential?: ConnectorCredential;
}

export interface HealthResult {
  onlineState: InfraOnlineState;
  checkedAt: Date;
  detail?: string;
  /** Set only when this call just trust-on-first-use-pinned a brand new
   * host key (no fingerprint was previously known for this host) — lets
   * the caller persist it onto the credential so the pin survives a
   * process restart. Never set when an already-known fingerprint simply
   * matched again. */
  newlyPinnedHostKeyFingerprint?: string;
}

export interface MetricReading {
  kind: InfraMetricKind;
  label?: string;
  value: number;
  unit: string;
  collectedAt: Date;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled?: boolean;
}

export interface ActionResult {
  success: boolean;
  detail?: string;
}

export interface DiscoveredAsset {
  name: string;
  host: string;
  category: string;
  metadata?: Record<string, unknown>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
