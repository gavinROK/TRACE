import { AlertSeverity } from "@prisma/client";
import { DevicePostureRule } from "./device-posture.rule";

function device(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "device_1",
    name: "Test Device",
    ownerId: null,
    diskEncrypted: true,
    firewallEnabled: true,
    osUpToDate: true,
    screenLockEnabled: true,
    ...overrides,
  };
}

describe("DevicePostureRule", () => {
  const prisma = { device: { findMany: jest.fn() } };
  const rule = new DevicePostureRule(prisma as never);

  beforeEach(() => {
    prisma.device.findMany.mockReset();
  });

  it("does nothing for a fully healthy device", async () => {
    prisma.device.findMany.mockResolvedValue([device()]);

    expect(await rule.evaluate("org_1")).toEqual([]);
  });

  it("does nothing for a device with entirely unknown posture", async () => {
    prisma.device.findMany.mockResolvedValue([
      device({
        diskEncrypted: null,
        firewallEnabled: null,
        osUpToDate: null,
        screenLockEnabled: null,
      }),
    ]);

    expect(await rule.evaluate("org_1")).toEqual([]);
  });

  it("flags a device with exactly one failing check as MEDIUM", async () => {
    prisma.device.findMany.mockResolvedValue([device({ diskEncrypted: false })]);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe(AlertSeverity.MEDIUM);
    expect(findings[0].evidence).toEqual({
      deviceId: "device_1",
      deviceName: "Test Device",
      failingChecks: ["disk encryption"],
    });
  });

  it("flags a device with two or more failing checks as HIGH", async () => {
    prisma.device.findMany.mockResolvedValue([
      device({ diskEncrypted: false, firewallEnabled: false }),
    ]);

    const findings = await rule.evaluate("org_1");

    expect(findings[0].severity).toBe(AlertSeverity.HIGH);
    expect(findings[0].evidence.failingChecks).toEqual(["disk encryption", "firewall"]);
  });

  it("attaches the device owner's id to the finding when the device has an owner", async () => {
    prisma.device.findMany.mockResolvedValue([
      device({ ownerId: "dev_1", diskEncrypted: false }),
    ]);

    const findings = await rule.evaluate("org_1");

    expect(findings[0].developerId).toBe("dev_1");
  });

  it("leaves developerId undefined for an unowned (shared) device", async () => {
    prisma.device.findMany.mockResolvedValue([device({ ownerId: null, diskEncrypted: false })]);

    const findings = await rule.evaluate("org_1");

    expect(findings[0].developerId).toBeUndefined();
  });

  it("evaluates every device independently", async () => {
    prisma.device.findMany.mockResolvedValue([
      device({ id: "healthy", name: "Healthy" }),
      device({ id: "at-risk", name: "At risk", diskEncrypted: false }),
    ]);

    const findings = await rule.evaluate("org_1");

    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.deviceId).toBe("at-risk");
  });
});
