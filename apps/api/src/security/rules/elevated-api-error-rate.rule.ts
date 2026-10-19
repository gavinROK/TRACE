import { Injectable } from "@nestjs/common";
import { AlertSeverity } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityAlertType, SecurityFinding, SecurityRule } from "../security-rule";

const MIN_REQUESTS_TO_CONSIDER = 20;
const MEDIUM_ERROR_RATE = 0.2;
const HIGH_ERROR_RATE = 0.5;

/**
 * Flags a provider whose error rate over the last 24h is unusually high.
 * A sustained spike in errors can mean a revoked/expired credential, a
 * breaking API change, or a service outage — all worth a look regardless
 * of cause.
 */
@Injectable()
export class ElevatedApiErrorRateRule implements SecurityRule {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(organizationId: string): Promise<SecurityFinding[]> {
    const since = new Date();
    since.setUTCHours(since.getUTCHours() - 24);

    const events = await this.prisma.apiUsageEvent.findMany({
      where: { organizationId, occurredAt: { gte: since } },
      select: { provider: true, requestCount: true, errorCount: true },
    });

    const totals = new Map<string, { requestCount: number; errorCount: number }>();
    for (const event of events) {
      const bucket = totals.get(event.provider) ?? { requestCount: 0, errorCount: 0 };
      bucket.requestCount += event.requestCount;
      bucket.errorCount += event.errorCount;
      totals.set(event.provider, bucket);
    }

    const findings: SecurityFinding[] = [];
    for (const [provider, { requestCount, errorCount }] of totals) {
      if (requestCount < MIN_REQUESTS_TO_CONSIDER) continue;

      const errorRate = errorCount / requestCount;
      if (errorRate < MEDIUM_ERROR_RATE) continue;

      findings.push({
        type: SecurityAlertType.ELEVATED_API_ERROR_RATE,
        dedupeKey: provider,
        severity: errorRate >= HIGH_ERROR_RATE ? AlertSeverity.HIGH : AlertSeverity.MEDIUM,
        reason:
          `${(errorRate * 100).toFixed(0)}% of requests to "${provider}" failed in the ` +
          `last 24h (${errorCount} of ${requestCount}). This could indicate an expired or ` +
          "revoked credential, a breaking API change, or a provider outage.",
        recommendedSteps: [
          `Check recent error details for calls to "${provider}".`,
          "Verify the credential used for this provider is still valid.",
          `Check "${provider}"'s own status page for a known outage.`,
        ],
        evidence: { provider, requestCount, errorCount, errorRate },
      });
    }
    return findings;
  }
}
