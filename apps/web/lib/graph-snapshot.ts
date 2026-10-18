/**
 * Mirrors apps/api/src/graph/graph-snapshot.ts — kept in sync by hand
 * since apps/web and apps/api are separate workspaces without a shared
 * types package.
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
