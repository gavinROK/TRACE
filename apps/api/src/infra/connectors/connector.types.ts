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
}

export type ConnectorCapability =
  | "discover"
  | "getHealth"
  | "getMetrics"
  | "getConfiguration"
  | "executeCommand"
  | "performAction";

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
