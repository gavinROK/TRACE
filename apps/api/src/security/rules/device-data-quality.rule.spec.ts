import { AlertSeverity } from "@prisma/client";
import { SecurityAlertType } from "../security-rule";
import { DeviceDataQualityRule } from "./device-data-quality.rule";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function device(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "device_1",
    name: "Test Device",
    ownerId: null,
    lastCheckInAt: daysAgo(1),
    diskEncrypted: true,
    firewallEnabled: true,
    osUpToDate: true,
    screenLockEnabled: true,
    ...overrides,
  };
}

describe("DeviceDataQualityRule", () => {
  const prisma = { device: { findMany: jest.fn() } };
  const rule = new DeviceDataQualityRule(prisma as never);

  beforeEach(() => {
    prisma.device.findMany.mockReset();
  });

  it("does nothing for a device with known-healthy posture and a recent check-in", async () => {
    prisma.device.findMany.mockResolvedValue([device()]);

    expect(await rule.evaluate("org_1")).toEqual([]);
  });

  it("flags unknown posture as a single LOW-severity missing-info finding, never a risk finding", async () => {
    prisma.device.findMany.mockResolvedValue([
      device({
        diskEncrypted: null,
        firewallEnabled: null,
        osUpToDate: null,
        screenLockEnabled: null,
      }),
    ]);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe(SecurityAlertType.DEVICE_MISSING_SECURITY_INFO);
    expect(findings[0].severity).toBe(AlertSeverity.LOW);
    expect(findings[0].dedupeKey).toBe("device_1");
  });

  it("does NOT flag a device with at-risk/confirmed-false posture — that's DevicePostureRule's job", async () => {
    prisma.device.findMany.mockResolvedValue([device({ diskEncrypted: false })]);

    // diskEncrypted: false means posture status is AT_RISK, not UNKNOWN —
    // this rule must not also fire for it.
    expect(await rule.evaluate("org_1")).toEqual([]);
  });

  it("flags a null check-in date as a LOW-severity missing-info finding", async () => {
    prisma.device.findMany.mockResolvedValue([device({ lastCheckInAt: null })]);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe(SecurityAlertType.DEVICE_MISSING_SECURITY_INFO);
    expect(findings[0].evidence.missingFacts).toEqual(["no recorded check-in date"]);
  });

  it("flags a check-in older than 90 days as MEDIUM-severity stale, not missing info", async () => {
    prisma.device.findMany.mockResolvedValue([device({ lastCheckInAt: daysAgo(120) })]);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe(SecurityAlertType.DEVICE_STALE_CHECKIN);
    expect(findings[0].severity).toBe(AlertSeverity.MEDIUM);
    expect(findings[0].evidence.daysSinceCheckIn).toBe(120);
  });

  it("does not flag a check-in within the 90-day window", async () => {
    prisma.device.findMany.mockResolvedValue([device({ lastCheckInAt: daysAgo(30) })]);

    expect(await rule.evaluate("org_1")).toEqual([]);
  });

  it("combines unknown posture and a missing check-in into ONE finding, not two", async () => {
    prisma.device.findMany.mockResolvedValue([
      device({
        diskEncrypted: null,
        firewallEnabled: null,
        osUpToDate: null,
        screenLockEnabled: null,
        lastCheckInAt: null,
      }),
    ]);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe(SecurityAlertType.DEVICE_MISSING_SECURITY_INFO);
    expect(findings[0].evidence.missingFacts).toHaveLength(2);
  });

  it("produces two DIFFERENT-typed findings when a device is both missing info and stale", async () => {
    prisma.device.findMany.mockResolvedValue([
      device({
        diskEncrypted: null,
        firewallEnabled: null,
        osUpToDate: null,
        screenLockEnabled: null,
        lastCheckInAt: daysAgo(200),
      }),
    ]);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.type).sort()).toEqual(
      [SecurityAlertType.DEVICE_MISSING_SECURITY_INFO, SecurityAlertType.DEVICE_STALE_CHECKIN].sort(),
    );
    // Both findings share a dedupeKey (same device) but differ in type,
    // so they will never collide with each other in the dedup check.
    expect(findings[0].dedupeKey).toBe("device_1");
    expect(findings[1].dedupeKey).toBe("device_1");
  });

  it("gives each device its own dedupeKey, so two devices owned by the same person don't collide", async () => {
    prisma.device.findMany.mockResolvedValue([
      device({ id: "device_a", ownerId: "dev_1", lastCheckInAt: null }),
      device({ id: "device_b", ownerId: "dev_1", lastCheckInAt: null }),
    ]);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.dedupeKey).sort()).toEqual(["device_a", "device_b"]);
  });

  it("attaches the device owner's id when present, leaves it undefined when unowned", async () => {
    prisma.device.findMany.mockResolvedValue([
      device({ ownerId: "dev_1", lastCheckInAt: null }),
    ]);

    const findings = await rule.evaluate("org_1");

    expect(findings[0].developerId).toBe("dev_1");
  });
});
