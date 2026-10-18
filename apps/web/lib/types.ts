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
  | "securityAlertsGroup";

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
  | SecurityAlertsGroupEntity;

/** The three per-developer metric leaf kinds (toggled by the filter bar). */
export const METRIC_KINDS: NodeKind[] = ["github", "apiUsage", "security"];
