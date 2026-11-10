import { AlertSeverity } from "@prisma/client";
import { ElevatedApiErrorRateRule } from "./elevated-api-error-rate.rule";

function event(provider: string, requestCount: number, errorCount: number) {
  return { provider, requestCount, errorCount };
}

describe("ElevatedApiErrorRateRule", () => {
  const prisma = { apiUsageEvent: { findMany: jest.fn() } };
  const rule = new ElevatedApiErrorRateRule(prisma as never);

  beforeEach(() => {
    prisma.apiUsageEvent.findMany.mockReset();
  });

  it("does nothing when the error rate is low", async () => {
    prisma.apiUsageEvent.findMany.mockResolvedValue([event("openai", 100, 2)]);

    expect(await rule.evaluate("org_1")).toEqual([]);
  });

  it("ignores low-volume providers even at a high error rate", async () => {
    prisma.apiUsageEvent.findMany.mockResolvedValue([event("openai", 5, 5)]);

    expect(await rule.evaluate("org_1")).toEqual([]);
  });

  it("flags a 25% error rate as MEDIUM", async () => {
    prisma.apiUsageEvent.findMany.mockResolvedValue([event("openai", 100, 25)]);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe(AlertSeverity.MEDIUM);
    expect(findings[0].evidence).toEqual({
      provider: "openai",
      requestCount: 100,
      errorCount: 25,
      errorRate: 0.25,
    });
  });

  it("flags a 60% error rate as HIGH", async () => {
    prisma.apiUsageEvent.findMany.mockResolvedValue([event("openai", 100, 60)]);

    const findings = await rule.evaluate("org_1");

    expect(findings[0].severity).toBe(AlertSeverity.HIGH);
  });

  it("sums multiple events for the same provider before computing the rate", async () => {
    prisma.apiUsageEvent.findMany.mockResolvedValue([
      event("openai", 50, 5),
      event("openai", 50, 20),
    ]);

    const findings = await rule.evaluate("org_1");

    expect(findings[0].evidence).toEqual({
      provider: "openai",
      requestCount: 100,
      errorCount: 25,
      errorRate: 0.25,
    });
  });
});
