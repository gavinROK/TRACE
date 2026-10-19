import { Injectable } from "@nestjs/common";
import { AlertSeverity } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityAlertType, SecurityFinding, SecurityRule } from "../security-rule";

const BASELINE_WINDOW_DAYS = 7;
const MIN_REQUESTS_TO_CONSIDER = 20;
const SPIKE_MULTIPLIER = 3;
const HIGH_SEVERITY_MULTIPLIER = 6;
const ZERO_BASELINE_HIGH_THRESHOLD = 100;

/**
 * Flags a provider whose request volume in the last 24h is far above that
 * provider's own trailing 7-day daily average for this organization. A
 * spike alone proves nothing — it's a prompt to check whether it was an
 * intentional load increase, a bug (e.g. a retry loop), or a credential
 * leak.
 */
@Injectable()
export class ApiUsageSpikeRule implements SecurityRule {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(organizationId: string): Promise<SecurityFinding[]> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - (BASELINE_WINDOW_DAYS + 1));
    const last24hStart = new Date();
    last24hStart.setUTCDate(last24hStart.getUTCDate() - 1);

    const events = await this.prisma.apiUsageEvent.findMany({
      where: { organizationId, occurredAt: { gte: since } },
      select: { provider: true, occurredAt: true, requestCount: true },
    });

    const totals = new Map<string, { last24h: number; baselineWindow: number }>();
    for (const event of events) {
      const bucket = totals.get(event.provider) ?? { last24h: 0, baselineWindow: 0 };
      if (event.occurredAt >= last24hStart) {
        bucket.last24h += event.requestCount;
      } else {
        bucket.baselineWindow += event.requestCount;
      }
      totals.set(event.provider, bucket);
    }

    const findings: SecurityFinding[] = [];
    for (const [provider, { last24h, baselineWindow }] of totals) {
      const baselineAvgPerDay = baselineWindow / BASELINE_WINDOW_DAYS;

      if (last24h < MIN_REQUESTS_TO_CONSIDER) continue;

      const isSpike =
        baselineAvgPerDay > 0
          ? last24h >= baselineAvgPerDay * SPIKE_MULTIPLIER
          : last24h >= MIN_REQUESTS_TO_CONSIDER;
      if (!isSpike) continue;

      const severity =
        baselineAvgPerDay > 0
          ? last24h >= baselineAvgPerDay * HIGH_SEVERITY_MULTIPLIER
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM
          : last24h >= ZERO_BASELINE_HIGH_THRESHOLD
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM;

      findings.push({
        type: SecurityAlertType.API_USAGE_SPIKE,
        dedupeKey: provider,
        severity,
        reason:
          `API requests to "${provider}" in the last 24h (${last24h}) are well above ` +
          `this organization's trailing ${BASELINE_WINDOW_DAYS}-day average for that ` +
          `provider (${baselineAvgPerDay.toFixed(1)}/day). This is a statistical anomaly, ` +
          "not evidence of misuse on its own.",
        recommendedSteps: [
          `Check which service or key is driving traffic to "${provider}".`,
          "Confirm whether this matches a known deploy, load test, or usage change.",
          "If unexplained, consider rotating the credential used for this provider.",
        ],
        evidence: { provider, last24hRequestCount: last24h, baselineAvgPerDay },
      });
    }
    return findings;
  }
}
