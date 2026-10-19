import { BadRequestException } from "@nestjs/common";
import { DevicesService } from "./devices.service";

describe("DevicesService", () => {
  const prisma = {
    developer: { findFirst: jest.fn() },
    device: { create: jest.fn(), findMany: jest.fn() },
  };
  const service = new DevicesService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("enrollDevice", () => {
    it("creates a device scoped to the organization, always as MANUAL enrollment", async () => {
      prisma.device.create.mockResolvedValue({
        id: "dev_1",
        name: "Ada's MacBook",
        deviceType: "LAPTOP",
        operatingSystem: "macOS",
        osVersion: "15.1",
        serialNumber: null,
        enrollmentType: "MANUAL",
        owner: null,
        diskEncrypted: true,
        firewallEnabled: true,
        osUpToDate: true,
        screenLockEnabled: true,
        lastCheckInAt: null,
        createdAt: new Date(),
      });

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
      prisma.device.create.mockResolvedValue({
        id: "device_1",
        name: "Shared server",
        deviceType: "SERVER",
        operatingSystem: "Linux",
        osVersion: "22.04",
        serialNumber: null,
        enrollmentType: "MANUAL",
        owner: { id: "dev_1", name: "Ada Chen" },
        diskEncrypted: null,
        firewallEnabled: null,
        osUpToDate: null,
        screenLockEnabled: null,
        lastCheckInAt: null,
        createdAt: new Date(),
      });

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
  });

  describe("listDevices", () => {
    it("scopes to the organization and computes posture status per device", async () => {
      prisma.device.findMany.mockResolvedValue([
        {
          id: "device_1",
          name: "At-risk laptop",
          deviceType: "LAPTOP",
          operatingSystem: "Windows",
          osVersion: "11",
          serialNumber: "SN123",
          enrollmentType: "SIMULATED",
          owner: null,
          diskEncrypted: false,
          firewallEnabled: true,
          osUpToDate: true,
          screenLockEnabled: true,
          lastCheckInAt: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.listDevices("org_1");

      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: "org_1" } }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].posture.status).toBe("AT_RISK");
    });
  });
});
