import { Injectable } from "@nestjs/common";
import { AlertSeverity } from "@prisma/client";
import { computePostureStatus } from "../../devices/device-posture";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityAlertType, SecurityFinding, SecurityRule } from "../security-rule";

const STALE_CHECKIN_DAYS = 90;

/**
 * Deliberately separate from DevicePostureRule, and deliberately never
 * HIGH/CRITICAL: this rule reports *missing information*, not confirmed
 * risk. "We don't know this device's posture" and "we know this device's
 * firewall is off" are different facts and must never look the same in
 * the alert list — that's the whole point of these two rules being
 * different types with different severity ceilings, not one rule with
 * more conditions.
 *
 * A device can contribute at most one finding per type here: unknown
 * posture and a missing check-in date are combined into a single
 * "missing info" finding when both apply, rather than two separate ones
 * — two findings of the *same type* for the *same device* would need
 * their own disambiguation beyond dedupeKey=deviceId, and there's no
 * real value in splitting them (both are just "we don't know enough
 * about this device" expressed two ways).
 */
@Injectable()
export class DeviceDataQualityRule implements SecurityRule {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(organizationId: string): Promise<SecurityFinding[]> {
    const devices = await this.prisma.device.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        lastCheckInAt: true,
        diskEncrypted: true,
        firewallEnabled: true,
        osUpToDate: true,
        screenLockEnabled: true,
      },
    });

    const staleSince = new Date();
    staleSince.setUTCDate(staleSince.getUTCDate() - STALE_CHECKIN_DAYS);

    const findings: SecurityFinding[] = [];

    for (const device of devices) {
      const missingFacts: string[] = [];
      if (computePostureStatus(device) === "UNKNOWN") {
        missingFacts.push("no security posture data (disk encryption, firewall, OS updates, screen lock)");
      }
      if (device.lastCheckInAt === null) {
        missingFacts.push("no recorded check-in date");
      }

      if (missingFacts.length > 0) {
        findings.push({
          type: SecurityAlertType.DEVICE_MISSING_SECURITY_INFO,
          dedupeKey: device.id,
          severity: AlertSeverity.LOW,
          developerId: device.ownerId ?? undefined,
          reason:
            `"${device.name}" has ${missingFacts.join(" and ")}. This is missing information, ` +
            "not a confirmed issue — the device may well be fine.",
          recommendedSteps: [
            `Record "${device.name}"'s posture and a check-in date the next time it's verified.`,
          ],
          evidence: { deviceId: device.id, deviceName: device.name, missingFacts },
        });
      }

      if (device.lastCheckInAt !== null && device.lastCheckInAt < staleSince) {
        const daysSince = Math.floor(
          (Date.now() - device.lastCheckInAt.getTime()) / (24 * 60 * 60 * 1000),
        );
        findings.push({
          type: SecurityAlertType.DEVICE_STALE_CHECKIN,
          dedupeKey: device.id,
          severity: AlertSeverity.MEDIUM,
          developerId: device.ownerId ?? undefined,
          reason:
            `"${device.name}" was last checked in ${daysSince} days ago, over the ` +
            `${STALE_CHECKIN_DAYS}-day threshold. Its last known posture may no longer be ` +
            "accurate.",
          recommendedSteps: [`Re-verify "${device.name}" and record a fresh check-in date.`],
          evidence: { deviceId: device.id, deviceName: device.name, daysSinceCheckIn: daysSince },
        });
      }
    }

    return findings;
  }
}
