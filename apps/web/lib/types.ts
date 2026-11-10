// Shared domain types for the TRACE org graph. In demo mode these are
// populated from simulated data (lib/data.ts); in live mode they're
// mapped from a real GET /graph/snapshot response (lib/map-snapshot.ts) —
// see lib/useGraphData.ts for which one a given session is using.

export type NodeKind =
  | "organization"
  | "department"
  | "developer"
  | "github"
  | "apiUsage"
  | "security"
  | "repositoryGroup"
  | "repository"
  | "apiUsageDashboard"
  | "securityAlertsGroup"
  | "deviceGroup"
  | "device";

export type ActivityLevel = "high" | "medium" | "low";

/** Mirrors apps/api/src/devices/device-posture.ts's DevicePostureStatus. */
export type DevicePostureStatus = "HEALTHY" | "AT_RISK" | "CRITICAL" | "UNKNOWN";

interface BaseEntity {
  id: string;
  kind: NodeKind;
  label: string;
  /** Null only for the single root (the organization) node. */
  parentId: string | null;
}

export interface OrganizationEntity extends BaseEntity {
  kind: "organization";
  description: string;
}

export interface DepartmentEntity extends BaseEntity {
  kind: "department";
  description: string;
}

export interface DeveloperEntity extends BaseEntity {
  kind: "developer";
  role: string;
  initials: string;
  activity: ActivityLevel;
  commitsThisWeek: number;
  openPullRequests: number;
}

export interface GithubMetricEntity extends BaseEntity {
  kind: "github";
  repositories: number;
  commitsThisWeek: number;
  openPullRequests: number;
}

export interface ApiUsageMetricEntity extends BaseEntity {
  kind: "apiUsage";
  requestsToday: number;
  errorRatePercent: number;
}

export interface SecurityMetricEntity extends BaseEntity {
  kind: "security";
  openAlerts: number;
  severity: ActivityLevel;
}

/** Groups repository nodes under the organization — a structural node like
 * a department, not a metric leaf. Only appears in live mode. */
export interface RepositoryGroupEntity extends BaseEntity {
  kind: "repositoryGroup";
  description: string;
}

export interface RepositoryEntity extends BaseEntity {
  kind: "repository";
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  commitCount: number;
  openPullRequestCount: number;
}

/** Org-wide API usage, reachable from the graph; opening it fetches the
 * full provider/trend breakdown. Only appears in live mode. */
export interface ApiUsageDashboardEntity extends BaseEntity {
  kind: "apiUsageDashboard";
  requestCount: number;
  providerCount: number;
}

/** Org-wide security alerts, reachable from the graph; opening it fetches
 * the full alert list. Only appears in live mode. */
export interface SecurityAlertsGroupEntity extends BaseEntity {
  kind: "securityAlertsGroup";
  openCount: number;
}

/** Groups device nodes under the organization. Ownership is shown as a
 * field (`ownerName`), not as graph nesting under the owning developer —
 * same reasoning as Repository: the graph's entities form a single-parent
 * tree, so a device can't structurally live under both its owner and a
 * flat "Devices" branch without a larger rewrite. Only in live mode. */
export interface DeviceGroupEntity extends BaseEntity {
  kind: "deviceGroup";
  description: string;
}

export interface DeviceSoftwareEntry {
  id: string;
  name: string;
  version: string | null;
  publisher: string | null;
  installedAt: string | null;
  source: string;
}

export interface DeviceEntity extends BaseEntity {
  kind: "device";
  deviceType: string;
  operatingSystem: string;
  osVersion: string;
  serialNumber: string | null;
  enrollmentType: string;
  ownerName: string | null;
  /** Infrastructure (a switch, a VM, ...) is often assigned to a team
   * rather than a person — independent of ownerName; a device may have
   * either, both, or neither. */
  departmentName: string | null;
  posture: {
    diskEncrypted: boolean | null;
    firewallEnabled: boolean | null;
    osUpToDate: boolean | null;
    screenLockEnabled: boolean | null;
    status: DevicePostureStatus;
  };
  lastCheckInAt: string | null;
  software: DeviceSoftwareEntry[];
}

export type OrgEntity =
  | OrganizationEntity
  | DepartmentEntity
  | DeveloperEntity
  | GithubMetricEntity
  | ApiUsageMetricEntity
  | SecurityMetricEntity
  | RepositoryGroupEntity
  | RepositoryEntity
  | ApiUsageDashboardEntity
  | SecurityAlertsGroupEntity
  | DeviceGroupEntity
  | DeviceEntity;

/** The three per-developer metric leaf kinds (toggled by the filter bar). */
export const METRIC_KINDS: NodeKind[] = ["github", "apiUsage", "security"];
