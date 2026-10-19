import { Injectable } from "@nestjs/common";
import { ActivityEventType } from "../activity/activity-event-type";
import { computePostureStatus } from "../devices/device-posture";
import { PrismaService } from "../prisma/prisma.service";
import { GraphSnapshot } from "./graph-snapshot";

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function isOpenPullRequest(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).state === "open"
  );
}

@Injectable()
export class GraphService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything here is a real database record or a count derived from
   * real database records — no simulated relationships. The organization
   * id is always the one OrgApiKeyGuard resolved from the caller's key.
   */
  async getSnapshot(organizationId: string): Promise<GraphSnapshot> {
    const [
      organization,
      departments,
      developers,
      repositories,
      activityEvents,
      openAlerts,
      usageByProvider,
      usageByDeveloper,
      devices,
    ] = await Promise.all([
        this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
        this.prisma.department.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
        this.prisma.developer.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
        this.prisma.repository.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
        this.prisma.activityEvent.findMany({
          where: { organizationId },
          select: { type: true, developerId: true, repositoryId: true, metadata: true },
        }),
        this.prisma.securityAlert.findMany({
          where: { organizationId, status: "OPEN" },
          select: { id: true, developerId: true },
        }),
        this.prisma.apiUsageEvent.groupBy({
          by: ["provider"],
          where: { organizationId },
          _sum: { requestCount: true },
        }),
        this.prisma.apiUsageEvent.groupBy({
          by: ["developerId"],
          where: { organizationId, developerId: { not: null } },
          _sum: { requestCount: true },
        }),
        this.prisma.device.findMany({
          where: { organizationId },
          include: {
            owner: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
            software: { orderBy: { name: "asc" } },
          },
          orderBy: { name: "asc" },
        }),
      ]);

    const commitCountByDeveloper = new Map<string, number>();
    const openPrCountByDeveloper = new Map<string, number>();
    const commitCountByRepo = new Map<string, number>();
    const openPrCountByRepo = new Map<string, number>();

    for (const event of activityEvents) {
      const isCommit = event.type === ActivityEventType.COMMIT;
      const isOpenPr = event.type === ActivityEventType.PULL_REQUEST && isOpenPullRequest(event.metadata);

      if (event.developerId) {
        if (isCommit) increment(commitCountByDeveloper, event.developerId);
        if (isOpenPr) increment(openPrCountByDeveloper, event.developerId);
      }
      if (event.repositoryId) {
        if (isCommit) increment(commitCountByRepo, event.repositoryId);
        if (isOpenPr) increment(openPrCountByRepo, event.repositoryId);
      }
    }

    const openAlertCountByDeveloper = new Map<string, number>();
    for (const alert of openAlerts) {
      if (alert.developerId) increment(openAlertCountByDeveloper, alert.developerId);
    }

    const apiRequestCountByDeveloper = new Map<string, number>();
    for (const row of usageByDeveloper) {
      if (row.developerId) apiRequestCountByDeveloper.set(row.developerId, row._sum.requestCount ?? 0);
    }

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      departments: departments.map((department) => ({
        id: department.id,
        name: department.name,
        description: department.description,
      })),
      developers: developers.map((developer) => ({
        id: developer.id,
        departmentId: developer.departmentId,
        name: developer.name,
        role: developer.role,
        githubLogin: developer.githubLogin,
        metrics: {
          commitCount: commitCountByDeveloper.get(developer.id) ?? 0,
          openPullRequestCount: openPrCountByDeveloper.get(developer.id) ?? 0,
          apiRequestCount: apiRequestCountByDeveloper.get(developer.id) ?? 0,
          openSecurityAlertCount: openAlertCountByDeveloper.get(developer.id) ?? 0,
        },
      })),
      repositories: repositories.map((repository) => ({
        id: repository.id,
        name: repository.name,
        fullName: repository.fullName,
        isPrivate: repository.isPrivate,
        defaultBranch: repository.defaultBranch,
        commitCount: commitCountByRepo.get(repository.id) ?? 0,
        openPullRequestCount: openPrCountByRepo.get(repository.id) ?? 0,
      })),
      apiUsageNodeSummary: {
        requestCount: usageByProvider.reduce((sum, row) => sum + (row._sum.requestCount ?? 0), 0),
        providerCount: usageByProvider.length,
      },
      securityAlertsNodeSummary: {
        openCount: openAlerts.length,
      },
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        deviceType: device.deviceType,
        operatingSystem: device.operatingSystem,
        osVersion: device.osVersion,
        serialNumber: device.serialNumber,
        enrollmentType: device.enrollmentType,
        ownerId: device.ownerId,
        ownerName: device.owner?.name ?? null,
        departmentId: device.departmentId,
        departmentName: device.department?.name ?? null,
        posture: {
          diskEncrypted: device.diskEncrypted,
          firewallEnabled: device.firewallEnabled,
          osUpToDate: device.osUpToDate,
          screenLockEnabled: device.screenLockEnabled,
          status: computePostureStatus(device),
        },
        lastCheckInAt: device.lastCheckInAt?.toISOString() ?? null,
        software: device.software.map((item) => ({
          id: item.id,
          name: item.name,
          version: item.version,
          publisher: item.publisher,
          installedAt: item.installedAt?.toISOString() ?? null,
          source: item.source,
        })),
      })),
    };
  }
}
