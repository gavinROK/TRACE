import { Inject, Injectable } from "@nestjs/common";
import { AlertStatus, Prisma, SecurityAlert } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SECURITY_RULES, SecurityRule } from "./security-rule";

const DEDUPE_WINDOW_HOURS = 24;

@Injectable()
export class SecurityDetectionService {
  constructor(
    @Inject(SECURITY_RULES) private readonly rules: SecurityRule[],
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Runs every registered rule for one organization and persists any new
   * findings — skipping a finding if an equivalent alert (same type,
   * same dedupeKey, same developer-or-org-wide scope, still OPEN) was
   * already created within the dedupe window, so re-running this
   * repeatedly doesn't spam duplicate alerts for the same ongoing
   * condition. dedupeKey (not just type+developerId) is what lets two
   * genuinely different findings — e.g. two separate devices owned by
   * the same person — both get persisted instead of the second looking
   * like a duplicate of the first.
   */
  async runDetection(organizationId: string): Promise<SecurityAlert[]> {
    const dedupeSince = new Date();
    dedupeSince.setUTCHours(dedupeSince.getUTCHours() - DEDUPE_WINDOW_HOURS);

    const created: SecurityAlert[] = [];

    for (const rule of this.rules) {
      const findings = await rule.evaluate(organizationId);

      for (const finding of findings) {
        const alreadyOpen = await this.prisma.securityAlert.findFirst({
          where: {
            organizationId,
            type: finding.type,
            dedupeKey: finding.dedupeKey ?? null,
            developerId: finding.developerId ?? null,
            status: AlertStatus.OPEN,
            detectedAt: { gte: dedupeSince },
          },
        });
        if (alreadyOpen) continue;

        const alert = await this.prisma.securityAlert.create({
          data: {
            organizationId,
            type: finding.type,
            dedupeKey: finding.dedupeKey,
            severity: finding.severity,
            developerId: finding.developerId,
            reason: finding.reason,
            recommendedSteps: finding.recommendedSteps,
            evidence: finding.evidence as Prisma.InputJsonValue,
          },
        });
        created.push(alert);
      }
    }

    return created;
  }

  listAlerts(organizationId: string, status?: AlertStatus) {
    return this.prisma.securityAlert.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { detectedAt: "desc" },
    });
  }
}
