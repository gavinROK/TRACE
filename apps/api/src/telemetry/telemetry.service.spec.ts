import { BadRequestException } from "@nestjs/common";
import { TelemetryService } from "./telemetry.service";

describe("TelemetryService", () => {
  const prisma = {
    developer: { findFirst: jest.fn() },
    apiUsageEvent: {
      create: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const service = new TelemetryService(prisma as never);

  beforeEach(() => {
    prisma.developer.findFirst.mockReset();
    prisma.apiUsageEvent.create.mockReset();
    prisma.apiUsageEvent.groupBy.mockReset();
    prisma.apiUsageEvent.findMany.mockReset();
  });

  describe("recordApiUsage", () => {
    it("creates an event with defaults when no developerId is given", async () => {
      prisma.apiUsageEvent.create.mockResolvedValue({ id: "evt_1" });

      await service.recordApiUsage("org_1", {
        actorType: "unknown",
        provider: "openai",
        service: "chat-completions",
      });

      expect(prisma.apiUsageEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org_1",
          developerId: undefined,
          actorType: "UNKNOWN",
          provider: "openai",
          service: "chat-completions",
          requestCount: 1,
          errorCount: 0,
        }),
      });
    });

    it("rejects actorType 'verified' with no developerId", async () => {
      await expect(
        service.recordApiUsage("org_1", {
          actorType: "verified",
          provider: "openai",
          service: "chat-completions",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.apiUsageEvent.create).not.toHaveBeenCalled();
    });

    it("rejects a developerId that doesn't belong to the caller's organization", async () => {
      prisma.developer.findFirst.mockResolvedValue(null);

      await expect(
        service.recordApiUsage("org_1", {
          actorType: "verified",
          provider: "openai",
          service: "chat-completions",
          developerId: "dev_from_another_org",
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.developer.findFirst).toHaveBeenCalledWith({
        where: { id: "dev_from_another_org", organizationId: "org_1" },
        select: { id: true },
      });
      expect(prisma.apiUsageEvent.create).not.toHaveBeenCalled();
    });

    it("accepts a verified developerId that belongs to the caller's organization", async () => {
      prisma.developer.findFirst.mockResolvedValue({ id: "dev_1" });
      prisma.apiUsageEvent.create.mockResolvedValue({ id: "evt_1" });

      await service.recordApiUsage("org_1", {
        actorType: "verified",
        provider: "openai",
        service: "chat-completions",
        developerId: "dev_1",
      });

      expect(prisma.apiUsageEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ developerId: "dev_1", actorType: "VERIFIED" }),
      });
    });
  });

  describe("getProviderSummary", () => {
    it("maps and sorts groupBy results by request count, descending", async () => {
      prisma.apiUsageEvent.groupBy.mockResolvedValue([
        {
          provider: "anthropic",
          _sum: { requestCount: 10, tokenCount: 100, estimatedCostUsd: 1, errorCount: 0 },
          _avg: { latencyMs: 200 },
        },
        {
          provider: "openai",
          _sum: { requestCount: 50, tokenCount: 500, estimatedCostUsd: 5, errorCount: 1 },
          _avg: { latencyMs: 300 },
        },
      ]);

      const result = await service.getProviderSummary("org_1");

      expect(prisma.apiUsageEvent.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: "org_1" } }),
      );
      expect(result.map((r) => r.provider)).toEqual(["openai", "anthropic"]);
      expect(result[0]).toEqual({
        provider: "openai",
        requestCount: 50,
        tokenCount: 500,
        estimatedCostUsd: 5,
        errorCount: 1,
        averageLatencyMs: 300,
      });
    });
  });

  describe("getUsageTrend", () => {
    it("buckets events by UTC day and sums requestCount/estimatedCostUsd", async () => {
      prisma.apiUsageEvent.findMany.mockResolvedValue([
        { occurredAt: new Date("2026-01-01T10:00:00Z"), requestCount: 3, estimatedCostUsd: 0.1 },
        { occurredAt: new Date("2026-01-01T20:00:00Z"), requestCount: 2, estimatedCostUsd: 0.2 },
        { occurredAt: new Date("2026-01-02T01:00:00Z"), requestCount: 7, estimatedCostUsd: 0.5 },
      ]);

      const result = await service.getUsageTrend("org_1", 7);

      expect(result).toHaveLength(2);
      expect(result[0].date).toBe("2026-01-01");
      expect(result[0].requestCount).toBe(5);
      expect(result[0].estimatedCostUsd).toBeCloseTo(0.3);
      expect(result[1]).toEqual({ date: "2026-01-02", requestCount: 7, estimatedCostUsd: 0.5 });
    });

    it("scopes the query to the given organization and lookback window", async () => {
      prisma.apiUsageEvent.findMany.mockResolvedValue([]);

      await service.getUsageTrend("org_1", 7);

      const call = prisma.apiUsageEvent.findMany.mock.calls[0][0];
      expect(call.where.organizationId).toBe("org_1");
      expect(call.where.occurredAt.gte).toBeInstanceOf(Date);
    });
  });
});
