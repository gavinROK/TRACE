import { BadRequestException, Injectable } from "@nestjs/common";
import { ActorType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ReportApiUsageDto } from "./dto/report-api-usage.dto";

export interface ProviderUsageSummary {
  provider: string;
  requestCount: number;
  tokenCount: number;
  estimatedCostUsd: number;
  errorCount: number;
  averageLatencyMs: number | null;
}

export interface DailyUsagePoint {
  date: string; // YYYY-MM-DD
  requestCount: number;
  estimatedCostUsd: number;
}

const DEFAULT_TREND_DAYS = 14;

@Injectable()
export class TelemetryService {
  constructor(private readonly prisma: PrismaService) {}

  async recordApiUsage(organizationId: string, dto: ReportApiUsageDto) {
    if (dto.developerId) {
      const developer = await this.prisma.developer.findFirst({
        where: { id: dto.developerId, organizationId },
        select: { id: true },
      });
      if (!developer) {
        throw new BadRequestException("developerId must belong to the caller's organization");
      }
    } else if (dto.actorType === "verified") {
      throw new BadRequestException("actorType 'verified' requires developerId");
    }

    return this.prisma.apiUsageEvent.create({
      data: {
        organizationId,
        developerId: dto.developerId,
        actorType: dto.actorType.toUpperCase() as ActorType,
        provider: dto.provider,
        service: dto.service,
        requestCount: dto.requestCount ?? 1,
        tokenCount: dto.tokenCount,
        estimatedCostUsd: dto.estimatedCostUsd,
        latencyMs: dto.latencyMs,
        errorCount: dto.errorCount ?? 0,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      },
    });
  }

  async getProviderSummary(organizationId: string): Promise<ProviderUsageSummary[]> {
    const rows = await this.prisma.apiUsageEvent.groupBy({
      by: ["provider"],
      where: { organizationId },
      _sum: { requestCount: true, tokenCount: true, estimatedCostUsd: true, errorCount: true },
      _avg: { latencyMs: true },
    });

    return rows
      .map((row) => ({
        provider: row.provider,
        requestCount: row._sum.requestCount ?? 0,
        tokenCount: row._sum.tokenCount ?? 0,
        estimatedCostUsd: row._sum.estimatedCostUsd ?? 0,
        errorCount: row._sum.errorCount ?? 0,
        averageLatencyMs: row._avg.latencyMs ?? null,
      }))
      .sort((a, b) => b.requestCount - a.requestCount);
  }

  /**
   * Buckets events by UTC day in application code rather than a raw
   * date-truncating SQL query — simpler to keep correct and test without a
   * live database, at the cost of pulling one row per event into memory.
   * Revisit with a raw aggregate query if usage volume ever makes that
   * cost matter.
   */
  async getUsageTrend(
    organizationId: string,
    days: number = DEFAULT_TREND_DAYS,
  ): Promise<DailyUsagePoint[]> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);

    const events = await this.prisma.apiUsageEvent.findMany({
      where: { organizationId, occurredAt: { gte: since } },
      select: { occurredAt: true, requestCount: true, estimatedCostUsd: true },
    });

    const byDay = new Map<string, { requestCount: number; estimatedCostUsd: number }>();
    for (const event of events) {
      const day = event.occurredAt.toISOString().slice(0, 10);
      const bucket = byDay.get(day) ?? { requestCount: 0, estimatedCostUsd: 0 };
      bucket.requestCount += event.requestCount;
      bucket.estimatedCostUsd += event.estimatedCostUsd ?? 0;
      byDay.set(day, bucket);
    }

    return Array.from(byDay.entries())
      .map(([date, totals]) => ({ date, ...totals }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
