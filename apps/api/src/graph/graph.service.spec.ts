import { GraphService } from "./graph.service";

describe("GraphService", () => {
  const prisma = {
    organization: { findUniqueOrThrow: jest.fn() },
    department: { findMany: jest.fn() },
    developer: { findMany: jest.fn() },
    repository: { findMany: jest.fn() },
    activityEvent: { findMany: jest.fn() },
    securityAlert: { findMany: jest.fn() },
    apiUsageEvent: { groupBy: jest.fn() },
    device: { findMany: jest.fn() },
  };
  const service = new GraphService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUniqueOrThrow.mockResolvedValue({
      id: "org_1",
      name: "Acme Corp",
      slug: "acme-corp",
    });
    prisma.department.findMany.mockResolvedValue([]);
    prisma.developer.findMany.mockResolvedValue([]);
    prisma.repository.findMany.mockResolvedValue([]);
    prisma.activityEvent.findMany.mockResolvedValue([]);
    prisma.securityAlert.findMany.mockResolvedValue([]);
    prisma.apiUsageEvent.groupBy.mockResolvedValue([]);
    prisma.device.findMany.mockResolvedValue([]);
  });

  it("returns basic organization fields", async () => {
    const snapshot = await service.getSnapshot("org_1");
    expect(snapshot.organization).toEqual({ id: "org_1", name: "Acme Corp", slug: "acme-corp" });
  });

  it("computes per-developer commit, open-PR, API usage, and alert counts from real event rows", async () => {
    prisma.developer.findMany.mockResolvedValue([
      { id: "dev_1", departmentId: "dept_1", name: "Ada", role: "Engineer", githubLogin: "ada-gh" },
    ]);
    prisma.activityEvent.findMany.mockResolvedValue([
      { type: "commit", developerId: "dev_1", repositoryId: "repo_1", metadata: null },
      { type: "commit", developerId: "dev_1", repositoryId: "repo_1", metadata: null },
      { type: "pull_request", developerId: "dev_1", repositoryId: "repo_1", metadata: { state: "open" } },
      { type: "pull_request", developerId: "dev_1", repositoryId: "repo_1", metadata: { state: "closed" } },
      // Unattributed commit — must not be counted against dev_1.
      { type: "commit", developerId: null, repositoryId: "repo_1", metadata: null },
    ]);
    prisma.securityAlert.findMany.mockResolvedValue([
      { id: "alert_1", developerId: "dev_1" },
      { id: "alert_2", developerId: null },
    ]);
    prisma.apiUsageEvent.groupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by[0] === "developerId") {
        return Promise.resolve([{ developerId: "dev_1", _sum: { requestCount: 42 } }]);
      }
      return Promise.resolve([{ provider: "openai", _sum: { requestCount: 42 } }]);
    });

    const snapshot = await service.getSnapshot("org_1");

    expect(snapshot.developers).toEqual([
      {
        id: "dev_1",
        departmentId: "dept_1",
        name: "Ada",
        role: "Engineer",
        githubLogin: "ada-gh",
        metrics: {
          commitCount: 2,
          openPullRequestCount: 1,
          apiRequestCount: 42,
          openSecurityAlertCount: 1,
        },
      },
    ]);
  });

  it("computes per-repository commit and open-PR counts, independent of developer attribution", async () => {
    prisma.repository.findMany.mockResolvedValue([
      { id: "repo_1", name: "web", fullName: "acme/web", isPrivate: true, defaultBranch: "main" },
    ]);
    prisma.activityEvent.findMany.mockResolvedValue([
      { type: "commit", developerId: null, repositoryId: "repo_1", metadata: null },
      { type: "pull_request", developerId: null, repositoryId: "repo_1", metadata: { state: "open" } },
    ]);

    const snapshot = await service.getSnapshot("org_1");

    expect(snapshot.repositories).toEqual([
      {
        id: "repo_1",
        name: "web",
        fullName: "acme/web",
        isPrivate: true,
        defaultBranch: "main",
        commitCount: 1,
        openPullRequestCount: 1,
      },
    ]);
  });

  it("summarizes org-wide API usage and open security alert counts for the node badges", async () => {
    prisma.apiUsageEvent.groupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by[0] === "provider") {
        return Promise.resolve([
          { provider: "openai", _sum: { requestCount: 10 } },
          { provider: "anthropic", _sum: { requestCount: 5 } },
        ]);
      }
      return Promise.resolve([]);
    });
    prisma.securityAlert.findMany.mockResolvedValue([
      { id: "a1", developerId: null },
      { id: "a2", developerId: null },
    ]);

    const snapshot = await service.getSnapshot("org_1");

    expect(snapshot.apiUsageNodeSummary).toEqual({ requestCount: 15, providerCount: 2 });
    expect(snapshot.securityAlertsNodeSummary).toEqual({ openCount: 2 });
  });

  it("maps devices with owner name and computed posture status, including unowned devices", async () => {
    prisma.device.findMany.mockResolvedValue([
      {
        id: "device_1",
        name: "Ada's laptop",
        deviceType: "LAPTOP",
        operatingSystem: "macOS",
        osVersion: "15.1",
        serialNumber: "SN1",
        enrollmentType: "SIMULATED",
        ownerId: "dev_1",
        owner: { id: "dev_1", name: "Ada Chen" },
        departmentId: null,
        department: null,
        diskEncrypted: false,
        firewallEnabled: true,
        osUpToDate: true,
        screenLockEnabled: true,
        lastCheckInAt: null,
        software: [],
      },
      {
        id: "device_2",
        name: "prod-db-01",
        deviceType: "SERVER",
        operatingSystem: "Ubuntu",
        osVersion: "22.04",
        serialNumber: null,
        enrollmentType: "SIMULATED",
        ownerId: null,
        owner: null,
        departmentId: null,
        department: null,
        diskEncrypted: true,
        firewallEnabled: true,
        osUpToDate: true,
        screenLockEnabled: true,
        lastCheckInAt: null,
        software: [],
      },
    ]);

    const snapshot = await service.getSnapshot("org_1");

    expect(snapshot.devices).toEqual([
      expect.objectContaining({
        id: "device_1",
        ownerId: "dev_1",
        ownerName: "Ada Chen",
        posture: expect.objectContaining({ status: "AT_RISK" }),
      }),
      expect.objectContaining({
        id: "device_2",
        ownerId: null,
        ownerName: null,
        posture: expect.objectContaining({ status: "HEALTHY" }),
      }),
    ]);
  });

  it("maps a device's department assignment and installed software onto the snapshot", async () => {
    const installedAt = new Date("2026-01-01T00:00:00.000Z");
    prisma.device.findMany.mockResolvedValue([
      {
        id: "device_1",
        name: "core-switch-01",
        deviceType: "SWITCH",
        operatingSystem: "Cisco IOS",
        osVersion: "15.2",
        serialNumber: null,
        enrollmentType: "MANUAL",
        ownerId: null,
        owner: null,
        departmentId: "dept_1",
        department: { id: "dept_1", name: "Operations" },
        diskEncrypted: null,
        firewallEnabled: null,
        osUpToDate: null,
        screenLockEnabled: null,
        lastCheckInAt: null,
        software: [
          {
            id: "sw_1",
            name: "Cisco IOS Firmware",
            version: "15.2(7)E",
            publisher: "Cisco Systems",
            installedAt,
            source: "MANUAL",
          },
        ],
      },
    ]);

    const snapshot = await service.getSnapshot("org_1");

    expect(snapshot.devices[0].departmentId).toBe("dept_1");
    expect(snapshot.devices[0].departmentName).toBe("Operations");
    expect(snapshot.devices[0].software).toEqual([
      {
        id: "sw_1",
        name: "Cisco IOS Firmware",
        version: "15.2(7)E",
        publisher: "Cisco Systems",
        installedAt: installedAt.toISOString(),
        source: "MANUAL",
      },
    ]);
  });
});
