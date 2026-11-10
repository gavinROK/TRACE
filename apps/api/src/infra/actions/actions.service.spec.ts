import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ActionsService } from "./actions.service";

describe("ActionsService", () => {
  const prisma = { infraDevice: { findFirst: jest.fn() } };
  const connectorRegistry = { get: jest.fn() };
  const credentialsService = { getDecryptedForDevice: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new ActionsService(prisma as never, connectorRegistry as never, credentialsService as never, auditLog as never);

  beforeEach(() => jest.clearAllMocks());

  it("blocks a destructive action without confirm:true and logs it as denied", async () => {
    await expect(service.performAction("env1", "user:u1", "d1", "stop", undefined, false)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.infraDevice.findFirst).not.toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }));
  });

  it("allows a non-destructive action (start) without confirm", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", name: "vm1", ipAddresses: ["10.0.0.2"], managementProtocols: ["PROXMOX_API"], notes: null });
    credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "PROXMOX_API", payload: {} });
    connectorRegistry.get.mockReturnValue({ performAction: jest.fn().mockResolvedValue({ success: true }) });

    const result = await service.performAction("env1", "user:u1", "d1", "start", undefined, false);

    expect(result.success).toBe(true);
  });

  it("proceeds with a destructive action when confirmed", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", name: "vm1", ipAddresses: ["10.0.0.2"], managementProtocols: ["PROXMOX_API"], notes: null });
    credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "PROXMOX_API", payload: {} });
    const performAction = jest.fn().mockResolvedValue({ success: true, detail: "stopped" });
    connectorRegistry.get.mockReturnValue({ performAction });

    await service.performAction("env1", "user:u1", "d1", "stop", undefined, true);

    expect(performAction).toHaveBeenCalled();
  });

  it("throws NotFoundException for a device outside the environment", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue(null);

    await expect(service.performAction("env1", "user:u1", "missing", "start", undefined, false)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("throws when no enrolled protocol supports performAction", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1", name: "switch1", ipAddresses: ["10.0.0.3"], managementProtocols: ["SNMP_V3"], notes: null });
    connectorRegistry.get.mockReturnValue({ performAction: undefined });

    await expect(service.performAction("env1", "user:u1", "d1", "start", undefined, false)).rejects.toThrow(
      BadRequestException,
    );
  });
});
