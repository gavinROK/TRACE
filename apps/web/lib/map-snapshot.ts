import type { GraphSnapshot } from "./graph-snapshot";
import type { ActivityLevel, OrgEntity } from "./types";

const REPOSITORY_GROUP_ID = "repository-group";
const API_USAGE_DASHBOARD_ID = "api-usage-dashboard";
const SECURITY_ALERTS_GROUP_ID = "security-alerts-group";
const DEVICE_GROUP_ID = "device-group";

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** Simple, documented heuristic — real activity scoring is future work. */
function activityFromCommitCount(commitCount: number): ActivityLevel {
  if (commitCount >= 10) return "high";
  if (commitCount >= 3) return "medium";
  return "low";
}

/**
 * Converts a real GET /graph/snapshot response into the same OrgEntity[]
 * shape the demo data already uses, so every existing graph/filter/stats
 * component works unchanged regardless of which mode produced the data.
 */
export function mapSnapshotToEntities(snapshot: GraphSnapshot): OrgEntity[] {
  const entities: OrgEntity[] = [];
  const orgId = snapshot.organization.id;

  entities.push({
    id: orgId,
    kind: "organization",
    label: snapshot.organization.name,
    parentId: null,
    description: `Live organization (slug: ${snapshot.organization.slug})`,
  });

  for (const department of snapshot.departments) {
    entities.push({
      id: department.id,
      kind: "department",
      label: department.name,
      parentId: orgId,
      description: department.description ?? "",
    });
  }

  for (const developer of snapshot.developers) {
    entities.push({
      id: developer.id,
      kind: "developer",
      label: developer.name,
      parentId: developer.departmentId ?? orgId,
      role: developer.role,
      initials: initialsOf(developer.name),
      activity: activityFromCommitCount(developer.metrics.commitCount),
      commitsThisWeek: developer.metrics.commitCount,
      openPullRequests: developer.metrics.openPullRequestCount,
    });

    entities.push({
      id: `${developer.id}-github`,
      kind: "github",
      label: "GitHub",
      parentId: developer.id,
      repositories: 0,
      commitsThisWeek: developer.metrics.commitCount,
      openPullRequests: developer.metrics.openPullRequestCount,
    });
    entities.push({
      id: `${developer.id}-api`,
      kind: "apiUsage",
      label: "API Usage",
      parentId: developer.id,
      requestsToday: developer.metrics.apiRequestCount,
      errorRatePercent: 0,
    });
    entities.push({
      id: `${developer.id}-security`,
      kind: "security",
      label: "Security Events",
      parentId: developer.id,
      openAlerts: developer.metrics.openSecurityAlertCount,
      severity: developer.metrics.openSecurityAlertCount > 0 ? "high" : "low",
    });
  }

  entities.push({
    id: REPOSITORY_GROUP_ID,
    kind: "repositoryGroup",
    label: "Repositories",
    parentId: orgId,
    description: `${snapshot.repositories.length} connected repositories`,
  });
  for (const repository of snapshot.repositories) {
    entities.push({
      id: repository.id,
      kind: "repository",
      label: repository.name,
      parentId: REPOSITORY_GROUP_ID,
      fullName: repository.fullName,
      isPrivate: repository.isPrivate,
      defaultBranch: repository.defaultBranch,
      commitCount: repository.commitCount,
      openPullRequestCount: repository.openPullRequestCount,
    });
  }

  entities.push({
    id: API_USAGE_DASHBOARD_ID,
    kind: "apiUsageDashboard",
    label: "API Usage",
    parentId: orgId,
    requestCount: snapshot.apiUsageNodeSummary.requestCount,
    providerCount: snapshot.apiUsageNodeSummary.providerCount,
  });

  entities.push({
    id: SECURITY_ALERTS_GROUP_ID,
    kind: "securityAlertsGroup",
    label: "Security Alerts",
    parentId: orgId,
    openCount: snapshot.securityAlertsNodeSummary.openCount,
  });

  entities.push({
    id: DEVICE_GROUP_ID,
    kind: "deviceGroup",
    label: "Devices",
    parentId: orgId,
    description: `${snapshot.devices.length} enrolled devices`,
  });
  for (const device of snapshot.devices) {
    entities.push({
      id: device.id,
      kind: "device",
      label: device.name,
      parentId: DEVICE_GROUP_ID,
      deviceType: device.deviceType,
      operatingSystem: device.operatingSystem,
      osVersion: device.osVersion,
      serialNumber: device.serialNumber,
      enrollmentType: device.enrollmentType,
      ownerName: device.ownerName,
      posture: device.posture,
    });
  }

  return entities;
}
