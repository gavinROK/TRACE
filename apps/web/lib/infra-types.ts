export type InfraDeviceCategory =
  | "PHYSICAL_SERVER"
  | "VIRTUAL_MACHINE"
  | "CONTAINER"
  | "ROUTER"
  | "FIREWALL"
  | "MANAGED_SWITCH"
  | "NAS"
  | "STORAGE_DEVICE"
  | "PRINTER"
  | "KVM"
  | "WORKSTATION"
  | "GENERIC_NETWORK_DEVICE";

export type InfraManagementProtocol = "SSH" | "PROXMOX_API" | "SNMP_V3" | "VENDOR_API" | "WINDOWS_WINRM" | "DOCKER_API" | "NONE";
export type InfraEnrollmentStatus = "DISCOVERED" | "PENDING" | "ENROLLED" | "ENROLLMENT_FAILED" | "DISABLED";
export type InfraOnlineState = "UNKNOWN" | "ONLINE" | "OFFLINE";

export interface InfraEnvironment {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  deviceCount: number;
  createdAt: string;
}

export interface InfraDeviceSummary {
  id: string;
  environmentId: string;
  name: string;
  category: InfraDeviceCategory;
  manufacturer: string | null;
  model: string | null;
  operatingSystem: string | null;
  osVersion: string | null;
  ipAddresses: string[];
  macAddresses: string[];
  managementProtocols: InfraManagementProtocol[];
  enrollmentStatus: InfraEnrollmentStatus;
  onlineState: InfraOnlineState;
  lastContactAt: string | null;
  discoveredAt: string;
  updatedAt: string;
  parentDevice: { id: string; name: string } | null;
  children: { id: string; name: string; category: InfraDeviceCategory; onlineState: InfraOnlineState }[];
}

export interface InfraMetricSample {
  id: string;
  deviceId: string;
  kind: string;
  label: string | null;
  value: number;
  unit: string;
  collectedAt: string;
}

export interface InfraCapability {
  protocol: InfraManagementProtocol;
  capability: string;
}

export interface InfraCredentialSummary {
  id: string;
  environmentId: string;
  deviceId: string | null;
  label: string;
  protocol: InfraManagementProtocol;
  createdAt: string;
  updatedAt: string;
}

export interface InfraDeviceDetail extends InfraDeviceSummary {
  notes: string | null;
  recentMetrics: InfraMetricSample[];
  credentials: InfraCredentialSummary[];
  capabilities: InfraCapability[];
}

export interface InfraDashboardSummary {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  unknownStateDevices: number;
  aggregateMemory: { usedBytes: number; totalBytes: number; hostsReporting: number };
  aggregateStorage: { usedBytes: number; totalBytes: number; hostsReporting: number };
}

export interface InfraTopologyNode {
  id: string;
  name: string;
  category: InfraDeviceCategory;
  onlineState: InfraOnlineState;
  enrollmentStatus: InfraEnrollmentStatus;
  parentDeviceId: string | null;
}

export interface InfraTopologyEdge {
  id: string;
  from: string;
  to: string;
  type: "HOSTS" | "CONNECTED_TO" | "DEPENDS_ON";
  kind: "VERIFIED" | "INFERRED";
}

export interface InfraTopologySnapshot {
  nodes: InfraTopologyNode[];
  edges: InfraTopologyEdge[];
  summary: InfraDashboardSummary;
}

export type InfraCommandStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";

export interface InfraCommandRun {
  id: string | null;
  environmentId: string;
  deviceId: string | null;
  targetLabel: string;
  command: string;
  status: InfraCommandStatus;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  requestedBy: string;
  startedAt: string | null;
  finishedAt: string | null;
  timeoutMs: number | null;
  createdAt: string;
}
