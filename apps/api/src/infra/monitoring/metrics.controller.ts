import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { InfraMetricKind } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { TraceAccessGuard } from "../auth/trace-access.guard";

@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/devices/:deviceId/metrics")
export class MetricsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async history(
    @Param("deviceId") deviceId: string,
    @Query("kind") kind: InfraMetricKind | undefined,
    @Query("sinceMinutes") sinceMinutes: string | undefined,
  ) {
    const since = new Date(Date.now() - Number(sinceMinutes ?? 1440) * 60 * 1000);
    return this.prisma.infraMetricSample.findMany({
      where: { deviceId, kind, collectedAt: { gte: since } },
      orderBy: { collectedAt: "asc" },
    });
  }
}
