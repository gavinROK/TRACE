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
  /** Full enough per-device detail that the frontend doesn't need a
   * second fetch to show a device's profile — same precedent as
   * `repositories`, unlike the telemetry/security dashboards which fetch
   * their richer detail separately on open. */
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
