import { Injectable } from "@nestjs/common";
import { AlertSeverity } from "@prisma/client";
import { ActivityEventType } from "../../activity/activity-event-type";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityAlertType, SecurityFinding, SecurityRule } from "../security-rule";

const BASELINE_WINDOW_DAYS = 13;
const MIN_COMMITS_TO_CONSIDER = 5;
const SPIKE_MULTIPLIER = 4;
const HIGH_SEVERITY_MULTIPLIER = 8;
const ZERO_BASELINE_HIGH_THRESHOLD = 15;

/**
 * Flags a developer whose commit volume in the last 24h is far above
 * their own recent baseline. This is an anomaly detector, not an
 * accusation — a legitimate bulk import, a squashed rebase, or a big but
 * ordinary push day all look the same to this rule. It exists to prompt a
 * quick, low-stakes check-in, never to label anyone.
 */
@Injectable()
export class UnusualCommitVolumeRule implements SecurityRule {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(organizationId: string): Promise<SecurityFinding[]> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - (BASELINE_WINDOW_DAYS + 1));
    const last24hStart = new Date();
    last24hStart.setUTCDate(last24hStart.getUTCDate() - 1);

    const events = await this.prisma.activityEvent.findMany({
      where: {
        organizationId,
        type: ActivityEventType.COMMIT,
        occurredAt: { gte: since },
        developerId: { not: null },
      },
      select: { developerId: true, occurredAt: true },
    });

    const totals = new Map<string, { last24h: number; baselineWindow: number }>();
    for (const event of events) {
      const developerId = event.developerId as string;
      const bucket = totals.get(developerId) ?? { last24h: 0, baselineWindow: 0 };
      if (event.occurredAt >= last24hStart) {
        bucket.last24h += 1;
      } else {
        bucket.baselineWindow += 1;
      }
      totals.set(developerId, bucket);
    }

    const findings: SecurityFinding[] = [];
    for (const [developerId, { last24h, baselineWindow }] of totals) {
      if (last24h < MIN_COMMITS_TO_CONSIDER) continue;

      const baselineAvgPerDay = baselineWindow / BASELINE_WINDOW_DAYS;
      const isSpike =
        baselineAvgPerDay > 0
          ? last24h >= baselineAvgPerDay * SPIKE_MULTIPLIER
          : last24h >= MIN_COMMITS_TO_CONSIDER;
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
        type: SecurityAlertType.UNUSUAL_COMMIT_VOLUME,
        severity,
        developerId,
        reason:
          `This developer's commit count in the last 24h (${last24h}) is well above their ` +
          `own trailing ${BASELINE_WINDOW_DAYS}-day average (${baselineAvgPerDay.toFixed(1)}/day). ` +
          "This is a statistical anomaly only — it is just as consistent with a bulk " +
          "import or a big ordinary push day as with anything concerning.",
        recommendedSteps: [
          "Skim the commits for anything unexpected (scope, file types, repos touched).",
          "If anything looks off, confirm with the developer whether this was intentional.",
        ],
        evidence: { last24hCommitCount: last24h, baselineAvgPerDay },
      });
    }
    return findings;
  }
}
