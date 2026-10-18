// Shared domain types for the TRACE org graph. Phase 1 uses simulated data
// that conforms to these shapes; later phases will populate them from the
// GitHub, API telemetry, and security integrations instead.

export type NodeKind =
  | "organization"
  | "department"
  | "developer"
  | "github"
  | "apiUsage"
  | "security";

export type ActivityLevel = "high" | "medium" | "low";

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

export type OrgEntity =
  | OrganizationEntity
  | DepartmentEntity
  | DeveloperEntity
  | GithubMetricEntity
  | ApiUsageMetricEntity
  | SecurityMetricEntity;

/** The three leaf metric kinds that hang off a developer node. */
export const METRIC_KINDS: NodeKind[] = ["github", "apiUsage", "security"];
