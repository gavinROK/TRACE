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
  devices: Array<{
    id: string;
    name: string;
    deviceType: string;
    operatingSystem: string;
    osVersion: string;
    serialNumber: string | null;
    enrollmentType: string;
    ownerId: string | null;
    ownerName: string | null;
    departmentId: string | null;
    departmentName: string | null;
    posture: {
      diskEncrypted: boolean | null;
      firewallEnabled: boolean | null;
      osUpToDate: boolean | null;
      screenLockEnabled: boolean | null;
      status: "HEALTHY" | "AT_RISK" | "CRITICAL" | "UNKNOWN";
    };
    lastCheckInAt: string | null;
    software: Array<{
      id: string;
      name: string;
      version: string | null;
      publisher: string | null;
      installedAt: string | null;
      source: string;
    }>;
  }>;
}
