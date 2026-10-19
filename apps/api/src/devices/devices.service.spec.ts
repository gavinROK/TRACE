import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DevicesService } from "./devices.service";

function rawDevice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "device_1",
    name: "Ada's MacBook",
    deviceType: "LAPTOP",
    operatingSystem: "macOS",
    osVersion: "15.1",
    serialNumber: null,
    enrollmentType: "MANUAL",
    owner: null,
    department: null,
    diskEncrypted: true,
    firewallEnabled: true,
    osUpToDate: true,
    screenLockEnabled: true,
    lastCheckInAt: null,
    software: [],
    createdAt: new Date(),
    ...overrides,
  };
}

describe("DevicesService", () => {
  const prisma = {
    developer: { findFirst: jest.fn() },
    department: { findFirst: jest.fn() },
    device: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), findFirstOrThrow: jest.fn() },
    softwareInstallation: { createMany: jest.fn() },
  };
  const service = new DevicesService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("enrollDevice", () => {
    it("creates a device scoped to the organization, always as MANUAL enrollment", async () => {
      prisma.device.create.mockResolvedValue(rawDevice());

      await service.enrollDevice("org_1", {
        name: "Ada's MacBook",
        deviceType: "LAPTOP",
        operatingSystem: "macOS",
        osVersion: "15.1",
      });

      expect(prisma.device.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: "org_1", enrollmentType: "MANUAL" }),
        }),
      );
    });

    it("rejects an ownerId that doesn't belong to the caller's organization", async () => {
      prisma.developer.findFirst.mockResolvedValue(null);

      await expect(
        service.enrollDevice("org_1", {
          name: "Shared server",
          deviceType: "SERVER",
          operatingSystem: "Linux",
          osVersion: "22.04",
          ownerId: "dev_from_another_org",
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.developer.findFirst).toHaveBeenCalledWith({
        where: { id: "dev_from_another_org", organizationId: "org_1" },
        select: { id: true },
      });
      expect(prisma.device.create).not.toHaveBeenCalled();
    });

    it("accepts an ownerId that belongs to the caller's organization", async () => {
      prisma.developer.findFirst.mockResolvedValue({ id: "dev_1" });
      prisma.device.create.mockResolvedValue(
        rawDevice({
          name: "Shared server",
          deviceType: "SERVER",
          owner: { id: "dev_1", name: "Ada Chen" },
          diskEncrypted: null,
          firewallEnabled: null,
          osUpToDate: null,
          screenLockEnabled: null,
        }),
      );

      const result = await service.enrollDevice("org_1", {
        name: "Shared server",
        deviceType: "SERVER",
        operatingSystem: "Linux",
        osVersion: "22.04",
        ownerId: "dev_1",
      });

      expect(result.owner).toEqual({ id: "dev_1", name: "Ada Chen" });
      expect(result.posture.status).toBe("UNKNOWN");
    });

    it("rejects a departmentId that doesn't belong to the caller's organization", async () => {
      prisma.department.findFirst.mockResolvedValue(null);

      await expect(
        service.enrollDevice("org_1", {
          name: "core-switch-01",
          deviceType: "SWITCH",
          operatingSystem: "Cisco IOS",
          osVersion: "15.2",
          departmentId: "dept_from_another_org",
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.device.create).not.toHaveBeenCalled();
    });

    it("accepts a departmentId that belongs to the caller's organization", async () => {
      prisma.department.findFirst.mockResolvedValue({ id: "dept_1" });
      prisma.device.create.mockResolvedValue(
        rawDevice({
          name: "core-switch-01",
          deviceType: "SWITCH",
          department: { id: "dept_1", name: "Operations" },
        }),
      );

      const result = await service.enrollDevice("org_1", {
        name: "core-switch-01",
        deviceType: "SWITCH",
        operatingSystem: "Cisco IOS",
        osVersion: "15.2",
        departmentId: "dept_1",
      });

      expect(result.department).toEqual({ id: "dept_1", name: "Operations" });
    });

    it("parses lastCheckInAt into a Date when given", async () => {
      prisma.device.create.mockResolvedValue(rawDevice());

      await service.enrollDevice("org_1", {
        name: "Ada's MacBook",
        deviceType: "LAPTOP",
        operatingSystem: "macOS",
        osVersion: "15.1",
        lastCheckInAt: "2026-01-01T00:00:00.000Z",
      });

      const call = prisma.device.create.mock.calls[0][0];
      expect(call.data.lastCheckInAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    });
  });

  describe("listDevices", () => {
    it("scopes to the organization and computes posture status per device", async () => {
      prisma.device.findMany.mockResolvedValue([
        rawDevice({ name: "At-risk laptop", diskEncrypted: false }),
      ]);

      const result = await service.listDevices("org_1");

      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: "org_1" } }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].posture.status).toBe("AT_RISK");
    });

    it("maps installed software onto each device profile", async () => {
      prisma.device.findMany.mockResolvedValue([
        rawDevice({
          software: [
            {
              id: "sw_1",
              name: "Visual Studio Code",
              version: "1.95",
              publisher: "Microsoft",
              installedAt: null,
              source: "MANUAL",
            },
          ],
        }),
      ]);

      const result = await service.listDevices("org_1");

      expect(result[0].software).toEqual([
        {
          id: "sw_1",
          name: "Visual Studio Code",
          version: "1.95",
          publisher: "Microsoft",
          installedAt: null,
          source: "MANUAL",
        },
      ]);
    });
  });

  describe("addSoftware", () => {
    it("rejects a device that doesn't belong to the caller's organization", async () => {
      prisma.device.findFirst.mockResolvedValue(null);

      await expect(
        service.addSoftware("org_1", "device_from_another_org", {
          source: "MANUAL",
          items: [{ name: "Docker Desktop" }],
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.softwareInstallation.createMany).not.toHaveBeenCalled();
    });

    it("bulk-creates software rows scoped to the organization and device, tagged with the given source", async () => {
      prisma.device.findFirst.mockResolvedValue({ id: "device_1" });
      prisma.device.findFirstOrThrow.mockResolvedValue(rawDevice());

      await service.addSoftware("org_1", "device_1", {
        source: "CSV_IMPORT",
        items: [
          { name: "Docker Desktop", version: "4.34", publisher: "Docker, Inc." },
          { name: "Slack" },
        ],
      });

      expect(prisma.softwareInstallation.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            organizationId: "org_1",
            deviceId: "device_1",
            name: "Docker Desktop",
            version: "4.34",
            publisher: "Docker, Inc.",
            source: "CSV_IMPORT",
          }),
          expect.objectContaining({
            organizationId: "org_1",
            deviceId: "device_1",
            name: "Slack",
            source: "CSV_IMPORT",
          }),
        ],
      });
    });

    it("parses each item's installedAt into a Date when given", async () => {
      prisma.device.findFirst.mockResolvedValue({ id: "device_1" });
      prisma.device.findFirstOrThrow.mockResolvedValue(rawDevice());

      await service.addSoftware("org_1", "device_1", {
        source: "MANUAL",
        items: [{ name: "Docker Desktop", installedAt: "2026-02-01T00:00:00.000Z" }],
      });

      const call = prisma.softwareInstallation.createMany.mock.calls[0][0];
      expect(call.data[0].installedAt).toEqual(new Date("2026-02-01T00:00:00.000Z"));
    });
  });
});
