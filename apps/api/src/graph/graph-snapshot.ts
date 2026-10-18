/**
 * Shape returned by GET /graph/snapshot. Deliberately lean: it's the
 * structural overview the frontend needs to render the graph (orgs,
 * departments, developers, repositories, and small per-node summary
 * counts) — not the richer per-domain detail. Opening a dashboard/alert
 * panel in the frontend fetches that separately from the existing
 * /telemetry/* and /security/alerts endpoints, so this endpoint doesn't
 * duplicate their logic.
 */
export interface GraphSnapshot {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  departments: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
  developers: Array<{
    id: string;
    departmentId: string | null;
    name: string;
    role: string;
    githubLogin: string | null;
    metrics: {
      commitCount: number;
      openPullRequestCount: number;
      apiRequestCount: number;
      openSecurityAlertCount: number;
    };
  }>;
  repositories: Array<{
    id: string;
    name: string;
    fullName: string;
    isPrivate: boolean;
    defaultBranch: string;
    commitCount: number;
    openPullRequestCount: number;
  }>;
  apiUsageNodeSummary: {
    requestCount: number;
    providerCount: number;
  };
  securityAlertsNodeSummary: {
    openCount: number;
  };
}
