import { BadGatewayException, BadRequestException, NotFoundException } from "@nestjs/common";
import { ConnectorError } from "../connectors/connector.types";
import { DiagnosticsService } from "./diagnostics.service";

describe("DiagnosticsService", () => {
  const prisma = { infraDevice: { findFirst: jest.fn() } };
  const connectorRegistry = { get: jest.fn() };
  const credentialsService = { getDecryptedForDevice: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new DiagnosticsService(prisma as never, connectorRegistry as never, credentialsService as never, auditLog as never);

  beforeEach(() => jest.clearAllMocks());

  describe("run", () => {
    it("throws NotFoundException for a device outside the environment", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue(null);

      await expect(service.run("env1", "missing", "user:u1", "os_info")).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when the device has no IP address", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", name: "d1", ipAddresses: [], managementProtocols: ["SSH"] });

      await expect(service.run("env1", "d1", "user:u1", "os_info")).rejects.toThrow(BadRequestException);
    });

    it("dispatches to the connector that implements runDiagnostic and audits success", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", name: "d1", ipAddresses: ["10.0.0.5"], managementProtocols: ["SSH"], managementPort: null });
      credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "SSH", payload: { username: "x" } });
      const runDiagnostic = jest.fn().mockResolvedValue({ name: "os_info", collectedAt: new Date(), output: "Ubuntu" });
      connectorRegistry.get.mockReturnValue({ runDiagnostic });

      const result = await service.run("env1", "d1", "user:u1", "os_info");

      expect(result.output).toBe("Ubuntu");
      expect(runDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ deviceId: "d1", host: "10.0.0.5" }), "os_info", undefined);
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: "device.diagnostic.os_info", outcome: "success" }));
    });

    it("audits an error outcome and converts a connector failure into a clean 502, not an opaque 500 (found live against an unreachable test port)", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", name: "d1", ipAddresses: ["10.0.0.5"], managementProtocols: ["SSH"], managementPort: null });
      credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "SSH", payload: { username: "x" } });
      connectorRegistry.get.mockReturnValue({ runDiagnostic: jest.fn().mockRejectedValue(new ConnectorError("connect ECONNREFUSED 127.0.0.1:2299")) });

      await expect(service.run("env1", "d1", "user:u1", "os_info")).rejects.toThrow(BadGatewayException);
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: "device.diagnostic.os_info", outcome: "error" }));
    });

    it("preserves a validation error's real status (400) instead of flattening it to 502", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", name: "d1", ipAddresses: ["10.0.0.5"], managementProtocols: ["SSH"], managementPort: null });
      credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "SSH", payload: { username: "x" } });
      connectorRegistry.get.mockReturnValue({ runDiagnostic: jest.fn().mockRejectedValue(new BadRequestException("\"service\" must be a plain identifier")) });

      await expect(service.run("env1", "d1", "user:u1", "service_status", { service: "x; rm -rf /" })).rejects.toThrow(BadRequestException);
    });

    it("throws when no enrolled protocol supports diagnostics", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", name: "d1", ipAddresses: ["10.0.0.5"], managementProtocols: ["SNMP_V3"], managementPort: null });
      connectorRegistry.get.mockReturnValue({ getHealth: jest.fn() }); // no runDiagnostic

      await expect(service.run("env1", "d1", "user:u1", "os_info")).rejects.toThrow(BadRequestException);
    });
  });

  describe("listSupported", () => {
    it("returns the full catalog when an enrolled protocol declares the runDiagnostic capability", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", managementProtocols: ["SSH"] });
      connectorRegistry.get.mockReturnValue({ getCapabilities: () => ["getHealth", "runDiagnostic"] });

      const names = await service.listSupported("env1", "d1");

      expect(names).toContain("security_posture");
      expect(names.length).toBe(10);
    });

    it("returns an empty list when nothing supports it", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", managementProtocols: ["SNMP_V3"] });
      connectorRegistry.get.mockReturnValue({ getCapabilities: () => ["getHealth"] });

      const names = await service.listSupported("env1", "d1");

      expect(names).toEqual([]);
    });
  });
});
