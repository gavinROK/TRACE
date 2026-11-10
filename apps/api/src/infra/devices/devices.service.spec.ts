import { ConflictException, NotFoundException } from "@nestjs/common";
import { InfraDevicesService } from "./devices.service";

describe("InfraDevicesService", () => {
  const prisma = {
    infraEnvironment: { findUnique: jest.fn() },
    infraDevice: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    infraMetricSample: { findMany: jest.fn() },
  };
  const connectorRegistry = { get: jest.fn() };
  const credentialsService = { listForEnvironment: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new InfraDevicesService(prisma as never, connectorRegistry as never, credentialsService as never, auditLog as never);

  beforeEach(() => jest.clearAllMocks());

  describe("resolveByName", () => {
    it("throws NotFoundException when no device has that name in the environment", async () => {
      prisma.infraDevice.findUnique.mockResolvedValue(null);

      await expect(service.resolveByName("env1", "beelink")).rejects.toThrow(NotFoundException);
    });

    it("resolves via the (environmentId, name) unique key — never a fuzzy match", async () => {
      prisma.infraDevice.findUnique.mockResolvedValue({ id: "d1", name: "beelink" });

      const device = await service.resolveByName("env1", "beelink");

      expect(prisma.infraDevice.findUnique).toHaveBeenCalledWith({
        where: { environmentId_name: { environmentId: "env1", name: "beelink" } },
      });
      expect(device).toEqual({ id: "d1", name: "beelink" });
    });
  });

  describe("create", () => {
    it("rejects an unknown environment", async () => {
      prisma.infraEnvironment.findUnique.mockResolvedValue(null);

      await expect(service.create("env1", { name: "beelink", category: "PHYSICAL_SERVER" } as never)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("rejects a duplicate device name within the same environment", async () => {
      prisma.infraEnvironment.findUnique.mockResolvedValue({ id: "env1" });
      prisma.infraDevice.findUnique.mockResolvedValue({ id: "existing" });

      await expect(service.create("env1", { name: "beelink", category: "PHYSICAL_SERVER" } as never)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.infraDevice.create).not.toHaveBeenCalled();
    });
  });

  describe("getDashboardSummary", () => {
    it("counts online/offline/unknown without implying shared capacity across hosts", async () => {
      prisma.infraDevice.findMany.mockResolvedValue([
        { id: "d1", onlineState: "ONLINE" },
        { id: "d2", onlineState: "ONLINE" },
        { id: "d3", onlineState: "OFFLINE" },
        { id: "d4", onlineState: "UNKNOWN" },
      ]);
      prisma.infraMetricSample.findMany.mockResolvedValue([]);

      const summary = await service.getDashboardSummary("env1");

      expect(summary.totalDevices).toBe(4);
      expect(summary.onlineDevices).toBe(2);
      expect(summary.offlineDevices).toBe(1);
      expect(summary.unknownStateDevices).toBe(1);
    });

    it("sums each host's most recent memory/storage bytes as an independent reporting total, not a shared pool", async () => {
      prisma.infraDevice.findMany.mockResolvedValue([
        { id: "d1", onlineState: "ONLINE" },
        { id: "d2", onlineState: "ONLINE" },
      ]);
      prisma.infraMetricSample.findMany.mockResolvedValue([
        // Most recent for d1 (listed first since the service queries desc)
        { deviceId: "d1", kind: "MEMORY_TOTAL_BYTES", value: 64_000_000_000, collectedAt: new Date("2026-01-02") },
        { deviceId: "d1", kind: "MEMORY_USED_BYTES", value: 32_000_000_000, collectedAt: new Date("2026-01-02") },
        // A stale, older reading for d1 that must NOT be double-counted
        { deviceId: "d1", kind: "MEMORY_TOTAL_BYTES", value: 999, collectedAt: new Date("2026-01-01") },
        { deviceId: "d2", kind: "MEMORY_TOTAL_BYTES", value: 16_000_000_000, collectedAt: new Date("2026-01-02") },
        { deviceId: "d2", kind: "MEMORY_USED_BYTES", value: 8_000_000_000, collectedAt: new Date("2026-01-02") },
      ]);

      const summary = await service.getDashboardSummary("env1");

      expect(summary.aggregateMemory).toEqual({ usedBytes: 40_000_000_000, totalBytes: 80_000_000_000, hostsReporting: 2 });
      expect(summary.aggregateStorage).toEqual({ usedBytes: 0, totalBytes: 0, hostsReporting: 0 });
    });
  });

  describe("update", () => {
    it("records who changed what, regardless of whether the caller was a browser session or an approved MCP action", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1" });
      prisma.infraDevice.update.mockResolvedValue({ id: "d1", name: "renamed" });

      await service.update("env1", "d1", "user:u1", { name: "renamed" } as never);

      expect(prisma.infraDevice.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "d1" }, data: { name: "renamed" } }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          environmentId: "env1",
          actor: "user:u1",
          action: "device.update",
          targetType: "InfraDevice",
          targetId: "d1",
          detail: { fields: ["name"] },
        }),
      );
    });

    it("throws NotFoundException for a device outside the environment and never writes or audits", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue(null);

      await expect(service.update("env1", "missing", "user:u1", { name: "x" } as never)).rejects.toThrow(NotFoundException);
      expect(prisma.infraDevice.update).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });

  describe("get — capabilities", () => {
    it("only lists a capability when both the device claims the protocol and a connector implements it", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({
        id: "d1",
        managementProtocols: ["SSH", "WINDOWS_WINRM"],
        notes: null,
      });
      prisma.infraMetricSample.findMany.mockResolvedValue([]);
      credentialsService.listForEnvironment.mockResolvedValue([]);
      connectorRegistry.get.mockImplementation((protocol: string) =>
        protocol === "SSH" ? { getCapabilities: () => ["getHealth", "executeCommand"] } : undefined,
      );

      const result = await service.get("env1", "d1");

      expect(result.capabilities).toEqual([
        { protocol: "SSH", capability: "getHealth" },
        { protocol: "SSH", capability: "executeCommand" },
      ]);
    });
  });

  describe("markEnrolled", () => {
    it("flips a DISCOVERED device to ENROLLED and audit-logs the transition", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", enrollmentStatus: "DISCOVERED" });
      prisma.infraDevice.update.mockResolvedValue({ id: "d1", enrollmentStatus: "ENROLLED" });

      const result = await service.markEnrolled("env1", "d1", "user:u1");

      expect(prisma.infraDevice.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "d1" },
        data: { enrollmentStatus: "ENROLLED" },
      }));
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "device.enrollment-status.enrolled",
        actor: "user:u1",
        detail: { previousStatus: "DISCOVERED" },
      }));
      expect(result.enrollmentStatus).toBe("ENROLLED");
    });

    it("is idempotent — re-enrolling an already-ENROLLED device writes nothing", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", enrollmentStatus: "ENROLLED" });

      await service.markEnrolled("env1", "d1", "user:u1");

      expect(prisma.infraDevice.update).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for a device outside the environment", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue(null);

      await expect(service.markEnrolled("env1", "missing", "user:u1")).rejects.toThrow(NotFoundException);
    });
  });
});
