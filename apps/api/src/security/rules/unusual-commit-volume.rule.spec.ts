import { AlertSeverity } from "@prisma/client";
import { UnusualCommitVolumeRule } from "./unusual-commit-volume.rule";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * HOUR_MS);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function commitEvent(developerId: string, occurredAt: Date) {
  return { developerId, occurredAt };
}

function repeated(developerId: string, occurredAtFn: (i: number) => Date, count: number) {
  return Array.from({ length: count }, (_, i) => commitEvent(developerId, occurredAtFn(i)));
}

describe("UnusualCommitVolumeRule", () => {
  const prisma = { activityEvent: { findMany: jest.fn() } };
  const rule = new UnusualCommitVolumeRule(prisma as never);

  beforeEach(() => {
    prisma.activityEvent.findMany.mockReset();
  });

  it("does nothing for a developer committing at their normal pace", async () => {
    const events = [
      ...repeated("dev_1", () => hoursAgo(12), 3),
      ...Array.from({ length: 13 }, (_, d) => repeated("dev_1", () => daysAgo(d + 2), 3)).flat(),
    ];
    prisma.activityEvent.findMany.mockResolvedValue(events);

    expect(await rule.evaluate("org_1")).toEqual([]);
  });

  it("flags a developer committing far above their own baseline", async () => {
    const events = [
      ...repeated("dev_1", () => hoursAgo(12), 20),
      ...Array.from({ length: 13 }, (_, d) => repeated("dev_1", () => daysAgo(d + 2), 2)).flat(),
    ];
    prisma.activityEvent.findMany.mockResolvedValue(events);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].developerId).toBe("dev_1");
    expect(findings[0].evidence.last24hCommitCount).toBe(20);
  });

  it("ignores small absolute commit counts even with a huge ratio", async () => {
    prisma.activityEvent.findMany.mockResolvedValue(repeated("dev_1", () => hoursAgo(12), 3));

    expect(await rule.evaluate("org_1")).toEqual([]);
  });

  it("evaluates each developer independently", async () => {
    const events = [
      ...repeated("dev_spiking", () => hoursAgo(12), 20),
      ...Array.from({ length: 13 }, (_, d) =>
        repeated("dev_spiking", () => daysAgo(d + 2), 2),
      ).flat(),
      ...repeated("dev_normal", () => hoursAgo(12), 3),
      ...Array.from({ length: 13 }, (_, d) => repeated("dev_normal", () => daysAgo(d + 2), 3)).flat(),
    ];
    prisma.activityEvent.findMany.mockResolvedValue(events);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].developerId).toBe("dev_spiking");
  });

  it("queries only commit events with a known developer, scoped to the organization", async () => {
    prisma.activityEvent.findMany.mockResolvedValue([]);

    await rule.evaluate("org_1");

    const call = prisma.activityEvent.findMany.mock.calls[0][0];
    expect(call.where.organizationId).toBe("org_1");
    expect(call.where.type).toBe("commit");
    expect(call.where.developerId).toEqual({ not: null });
  });

  it("never sets severity HIGH based on a severity label alone — always includes a reason", async () => {
    const events = [
      ...repeated("dev_1", () => hoursAgo(12), 20),
      ...Array.from({ length: 13 }, (_, d) => repeated("dev_1", () => daysAgo(d + 2), 2)).flat(),
    ];
    prisma.activityEvent.findMany.mockResolvedValue(events);

    const [finding] = await rule.evaluate("org_1");

    expect(finding.severity).toBe(AlertSeverity.HIGH);
    expect(finding.reason.length).toBeGreaterThan(20);
    expect(finding.recommendedSteps.length).toBeGreaterThan(0);
  });
});
