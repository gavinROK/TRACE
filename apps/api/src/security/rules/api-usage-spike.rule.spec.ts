import { AlertSeverity } from "@prisma/client";
import { ApiUsageSpikeRule } from "./api-usage-spike.rule";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * HOUR_MS);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function event(provider: string, occurredAt: Date, requestCount: number) {
  return { provider, occurredAt, requestCount };
}

describe("ApiUsageSpikeRule", () => {
  const prisma = { apiUsageEvent: { findMany: jest.fn() } };
  const rule = new ApiUsageSpikeRule(prisma as never);

  beforeEach(() => {
    prisma.apiUsageEvent.findMany.mockReset();
  });

  it("does nothing when usage is in line with the baseline", async () => {
    const events = [
      event("openai", hoursAgo(12), 10),
      ...[2, 3, 4, 5, 6, 7, 8].map((d) => event("openai", daysAgo(d), 10)),
    ];
    prisma.apiUsageEvent.findMany.mockResolvedValue(events);

    const findings = await rule.evaluate("org_1");

    expect(findings).toEqual([]);
  });

  it("flags a 5x spike over baseline as MEDIUM", async () => {
    const events = [
      event("openai", hoursAgo(12), 50),
      ...[2, 3, 4, 5, 6, 7, 8].map((d) => event("openai", daysAgo(d), 10)),
    ];
    prisma.apiUsageEvent.findMany.mockResolvedValue(events);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe(AlertSeverity.MEDIUM);
    expect(findings[0].evidence).toEqual({
      provider: "openai",
      last24hRequestCount: 50,
      baselineAvgPerDay: 10,
    });
  });

  it("flags a 7x spike over baseline as HIGH", async () => {
    const events = [
      event("openai", hoursAgo(12), 70),
      ...[2, 3, 4, 5, 6, 7, 8].map((d) => event("openai", daysAgo(d), 10)),
    ];
    prisma.apiUsageEvent.findMany.mockResolvedValue(events);

    const findings = await rule.evaluate("org_1");

    expect(findings[0].severity).toBe(AlertSeverity.HIGH);
  });

  it("ignores small absolute volumes even with a huge ratio", async () => {
    const events = [event("openai", hoursAgo(12), 5)]; // no baseline events at all
    prisma.apiUsageEvent.findMany.mockResolvedValue(events);

    const findings = await rule.evaluate("org_1");

    expect(findings).toEqual([]);
  });

  it("flags brand-new high-volume usage with no baseline history as MEDIUM", async () => {
    const events = [event("openai", hoursAgo(12), 30)];
    prisma.apiUsageEvent.findMany.mockResolvedValue(events);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe(AlertSeverity.MEDIUM);
  });

  it("flags brand-new very-high-volume usage with no baseline history as HIGH", async () => {
    const events = [event("openai", hoursAgo(12), 150)];
    prisma.apiUsageEvent.findMany.mockResolvedValue(events);

    const findings = await rule.evaluate("org_1");

    expect(findings[0].severity).toBe(AlertSeverity.HIGH);
  });

  it("evaluates each provider independently", async () => {
    const events = [
      event("openai", hoursAgo(12), 50),
      ...[2, 3, 4, 5, 6, 7, 8].map((d) => event("openai", daysAgo(d), 10)),
      event("anthropic", hoursAgo(12), 10),
      ...[2, 3, 4, 5, 6, 7, 8].map((d) => event("anthropic", daysAgo(d), 10)),
    ];
    prisma.apiUsageEvent.findMany.mockResolvedValue(events);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.provider).toBe("openai");
  });
});
