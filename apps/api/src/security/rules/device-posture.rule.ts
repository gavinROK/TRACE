import { Injectable } from "@nestjs/common";
import { AlertSeverity } from "@prisma/client";
import { computePostureStatus, listFailingChecks } from "../../devices/device-posture";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityAlertType, SecurityFinding, SecurityRule } from "../security-rule";

/**
 * Flags a device with two or more failing posture checks (disk
 * encryption, firewall, OS updates, screen lock) as HIGH severity, or
 * exactly one as MEDIUM. Reuses computePostureStatus/listFailingChecks
 * from the devices module so this rule and the device list/profile UI
 * always agree on what "at risk" means — never re-derives its own
 * threshold logic.
 *
 * A device with unknown posture (no agent, never manually checked) never
 * produces a finding — only explicit `false` values do.
 */
@Injectable()
export class DevicePostureRule implements SecurityRule {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(organizationId: string): Promise<SecurityFinding[]> {
    const devices = await this.prisma.device.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        diskEncrypted: true,
        firewallEnabled: true,
        osUpToDate: true,
        screenLockEnabled: true,
      },
    });

    const findings: SecurityFinding[] = [];
    for (const device of devices) {
      const status = computePostureStatus(device);
      if (status !== "AT_RISK" && status !== "CRITICAL") continue;

      const failingChecks = listFailingChecks(device);

      findings.push({
        type: SecurityAlertType.DEVICE_POSTURE_RISK,
        severity: status === "CRITICAL" ? AlertSeverity.HIGH : AlertSeverity.MEDIUM,
        developerId: device.ownerId ?? undefined,
        reason:
          `"${device.name}" is failing ${failingChecks.length} security posture check` +
          `${failingChecks.length === 1 ? "" : "s"} (${failingChecks.join(", ")}). This reflects ` +
          "the device's reported configuration, not confirmed malicious activity.",
        recommendedSteps: [
          `Confirm "${device.name}"'s actual configuration with its owner or IT.`,
          ...failingChecks.map((check) => `Re-enable or fix: ${check}.`),
        ],
        evidence: { deviceId: device.id, deviceName: device.name, failingChecks },
      });
    }
    return findings;
  }
}
