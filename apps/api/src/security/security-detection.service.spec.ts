import { AlertSeverity, AlertStatus } from "@prisma/client";
import { SecurityDetectionService } from "./security-detection.service";
import { SecurityAlertType } from "./security-rule";

function finding(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: SecurityAlertType.API_USAGE_SPIKE,
    severity: AlertSeverity.MEDIUM,
    reason: "test reason",
    recommendedSteps: ["step one"],
    evidence: { foo: "bar" },
    ...overrides,
  };
}

describe("SecurityDetectionService", () => {
  const prisma = {
    securityAlert: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  };

  beforeEach(() => {
    prisma.securityAlert.findFirst.mockReset();
    prisma.securityAlert.create.mockReset();
    prisma.securityAlert.findMany.mockReset();
  });

  it("creates an alert for each finding when none is already open", async () => {
    const rule = { evaluate: jest.fn().mockResolvedValue([finding()]) };
    const service = new SecurityDetectionService([rule], prisma as never);
    prisma.securityAlert.findFirst.mockResolvedValue(null);
    prisma.securityAlert.create.mockResolvedValue({ id: "alert_1" });

    const created = await service.runDetection("org_1");

    expect(created).toEqual([{ id: "alert_1" }]);
    expect(prisma.securityAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        type: SecurityAlertType.API_USAGE_SPIKE,
        severity: AlertSeverity.MEDIUM,
      }),
    });
  });

  it("skips creating a duplicate when an equivalent alert is already open", async () => {
    const rule = { evaluate: jest.fn().mockResolvedValue([finding()]) };
    const service = new SecurityDetectionService([rule], prisma as never);
    prisma.securityAlert.findFirst.mockResolvedValue({ id: "existing_alert" });

    const created = await service.runDetection("org_1");

    expect(created).toEqual([]);
    expect(prisma.securityAlert.create).not.toHaveBeenCalled();
  });

  it("checks for an existing open alert scoped to type, dedupeKey, developer, and org", async () => {
    const rule = {
      evaluate: jest
        .fn()
        .mockResolvedValue([finding({ developerId: "dev_1", dedupeKey: "device_1" })]),
    };
    const service = new SecurityDetectionService([rule], prisma as never);
    prisma.securityAlert.findFirst.mockResolvedValue(null);
    prisma.securityAlert.create.mockResolvedValue({ id: "alert_1" });

    await service.runDetection("org_1");

    expect(prisma.securityAlert.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        type: SecurityAlertType.API_USAGE_SPIKE,
        dedupeKey: "device_1",
        developerId: "dev_1",
        status: AlertStatus.OPEN,
        detectedAt: { gte: expect.any(Date) },
      },
    });
  });

  it("does not drop a second finding that shares type+developerId but has a different dedupeKey", async () => {
    // The exact bug this column fixes: two devices owned by the same
    // person, both flagged by the same rule in the same run, must both
    // be persisted rather than the second looking like a duplicate.
    const rule = {
      evaluate: jest.fn().mockResolvedValue([
        finding({ developerId: "dev_1", dedupeKey: "device_a" }),
        finding({ developerId: "dev_1", dedupeKey: "device_b" }),
      ]),
    };
    const service = new SecurityDetectionService([rule], prisma as never);
    prisma.securityAlert.findFirst.mockResolvedValue(null);
    prisma.securityAlert.create.mockResolvedValue({ id: "alert" });

    const created = await service.runDetection("org_1");

    expect(created).toHaveLength(2);
    expect(prisma.securityAlert.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ dedupeKey: "device_a" }) }),
    );
    expect(prisma.securityAlert.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ dedupeKey: "device_b" }) }),
    );
  });

  it("runs every registered rule and aggregates their findings", async () => {
    const ruleA = { evaluate: jest.fn().mockResolvedValue([finding()]) };
    const ruleB = { evaluate: jest.fn().mockResolvedValue([finding(), finding()]) };
    const service = new SecurityDetectionService([ruleA, ruleB], prisma as never);
    prisma.securityAlert.findFirst.mockResolvedValue(null);
    prisma.securityAlert.create.mockResolvedValue({ id: "alert" });

    const created = await service.runDetection("org_1");

    expect(ruleA.evaluate).toHaveBeenCalledWith("org_1");
    expect(ruleB.evaluate).toHaveBeenCalledWith("org_1");
    expect(created).toHaveLength(3);
  });

  it("listAlerts scopes to the organization and optionally filters by status", async () => {
    const service = new SecurityDetectionService([], prisma as never);
    prisma.securityAlert.findMany.mockResolvedValue([]);

    await service.listAlerts("org_1", AlertStatus.OPEN);

    expect(prisma.securityAlert.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", status: AlertStatus.OPEN },
      orderBy: { detectedAt: "desc" },
    });
  });
});
