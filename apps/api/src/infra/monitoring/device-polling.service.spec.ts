import { NotFoundException } from "@nestjs/common";
import { DevicePollingService } from "./device-polling.service";

describe("DevicePollingService", () => {
  const prisma = {
    infraDevice: { findFirst: jest.fn(), update: jest.fn() },
    infraMetricSample: { createMany: jest.fn() },
  };
  const connectorRegistry = { get: jest.fn(), require: jest.fn() };
  const credentialsService = { getDecryptedForDevice: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new DevicePollingService(prisma as never, connectorRegistry as never, credentialsService as never, auditLog as never);

  beforeEach(() => jest.clearAllMocks());

  it("throws when the device does not exist in the environment", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue(null);

    await expect(service.pollDevice("env1", "missing")).rejects.toThrow(NotFoundException);
  });

  it("reports UNKNOWN when the device has no IP address recorded", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", ipAddresses: [], managementProtocols: ["SSH"] });

    const result = await service.pollDevice("env1", "d1");

    expect(result.onlineState).toBe("UNKNOWN");
    expect(result.detail).toMatch(/No usable protocol/);
  });

  it("reports UNKNOWN when no credential exists for any claimed protocol", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", ipAddresses: ["10.0.0.5"], managementProtocols: ["SSH"] });
    connectorRegistry.get.mockReturnValue({ getHealth: jest.fn() });
    credentialsService.getDecryptedForDevice.mockResolvedValue(undefined);

    const result = await service.pollDevice("env1", "d1");

    expect(result.onlineState).toBe("UNKNOWN");
  });

  it("calls getHealth, updates onlineState, and records an audit entry", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", ipAddresses: ["10.0.0.5"], managementProtocols: ["SSH"], lastContactAt: null });
    connectorRegistry.get.mockReturnValue({});
    credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "SSH", payload: { username: "x" } });
    const getHealth = jest.fn().mockResolvedValue({ onlineState: "ONLINE", checkedAt: new Date("2026-01-01") });
    connectorRegistry.require.mockReturnValue({ getHealth });

    const result = await service.pollDevice("env1", "d1");

    expect(result.onlineState).toBe("ONLINE");
    expect(prisma.infraDevice.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { onlineState: "ONLINE", lastContactAt: new Date("2026-01-01") },
    });
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: "device.health-check" }));
  });

  it("collects metrics and stores them when the connector supports getMetrics and the device is online", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", ipAddresses: ["10.0.0.5"], managementProtocols: ["SSH"] });
    connectorRegistry.get.mockReturnValue({});
    credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "SSH", payload: {} });
    const readings = [{ kind: "CPU_UTILIZATION", value: 10, unit: "percent", collectedAt: new Date() }];
    connectorRegistry.require.mockReturnValue({
      getHealth: jest.fn().mockResolvedValue({ onlineState: "ONLINE", checkedAt: new Date() }),
      getMetrics: jest.fn().mockResolvedValue(readings),
    });

    const result = await service.pollDevice("env1", "d1");

    expect(result.metricsCollected).toBe(1);
    expect(prisma.infraMetricSample.createMany).toHaveBeenCalled();
  });

  it("does not collect metrics when the device is offline", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", ipAddresses: ["10.0.0.5"], managementProtocols: ["SSH"] });
    connectorRegistry.get.mockReturnValue({});
    credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "SSH", payload: {} });
    const getMetrics = jest.fn();
    connectorRegistry.require.mockReturnValue({
      getHealth: jest.fn().mockResolvedValue({ onlineState: "OFFLINE", checkedAt: new Date() }),
      getMetrics,
    });

    const result = await service.pollDevice("env1", "d1");

    expect(result.metricsCollected).toBe(0);
    expect(getMetrics).not.toHaveBeenCalled();
  });
});
