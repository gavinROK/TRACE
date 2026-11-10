import { NotFoundException } from "@nestjs/common";
import { CommandExecutionService } from "./command-execution.service";

describe("CommandExecutionService", () => {
  const prisma = { infraCommandRun: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() } };
  const connectorRegistry = { require: jest.fn() };
  const credentialsService = { getDecryptedForDevice: jest.fn() };
  const devicesService = { resolveByName: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new CommandExecutionService(
    prisma as never,
    connectorRegistry as never,
    credentialsService as never,
    devicesService as never,
    auditLog as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it("propagates NotFoundException when the device name does not resolve — never falls back to a guess", async () => {
    devicesService.resolveByName.mockRejectedValue(new NotFoundException("no such device"));

    await expect(service.executeOnDevice("env1", "user:u1", "unknown-host", "uptime")).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.infraCommandRun.create).not.toHaveBeenCalled();
  });

  it("creates a RUNNING run row before attempting the command", async () => {
    devicesService.resolveByName.mockResolvedValue({ id: "d1", name: "beelink", ipAddresses: ["10.0.0.5"] });
    prisma.infraCommandRun.create.mockResolvedValue({ id: "run1" });
    credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "SSH", payload: {} });
    connectorRegistry.require.mockReturnValue({
      executeCommand: jest.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }),
    });
    prisma.infraCommandRun.update.mockResolvedValue({ id: "run1", status: "SUCCEEDED" });

    await service.executeOnDevice("env1", "user:u1", "beelink", "uptime");

    expect(prisma.infraCommandRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RUNNING", targetLabel: "beelink" }) }),
    );
  });

  it("marks the run FAILED (not throwing) when the device has no credential", async () => {
    devicesService.resolveByName.mockResolvedValue({ id: "d1", name: "beelink", ipAddresses: ["10.0.0.5"] });
    prisma.infraCommandRun.create.mockResolvedValue({ id: "run1" });
    credentialsService.getDecryptedForDevice.mockResolvedValue(undefined);
    prisma.infraCommandRun.update.mockResolvedValue({ id: "run1", status: "FAILED" });

    const result = await service.executeOnDevice("env1", "user:u1", "beelink", "uptime");

    expect(result.status).toBe("FAILED");
    expect(prisma.infraCommandRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("maps a successful exit code to SUCCEEDED and a non-zero code to FAILED", async () => {
    devicesService.resolveByName.mockResolvedValue({ id: "d1", name: "beelink", ipAddresses: ["10.0.0.5"] });
    prisma.infraCommandRun.create.mockResolvedValue({ id: "run1" });
    credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "SSH", payload: {} });
    connectorRegistry.require.mockReturnValue({
      executeCommand: jest.fn().mockResolvedValue({ exitCode: 1, stdout: "", stderr: "boom", timedOut: false }),
    });
    prisma.infraCommandRun.update.mockImplementation(({ data }) => ({ id: "run1", ...data }));

    const result = await service.executeOnDevice("env1", "user:u1", "beelink", "false");

    expect(result.status).toBe("FAILED");
  });

  it("runs a group command across devices and keeps going when one device name can't be resolved", async () => {
    devicesService.resolveByName.mockImplementation((_env: string, name: string) =>
      name === "bad-host" ? Promise.reject(new NotFoundException(`No device named "bad-host"`)) : Promise.resolve({ id: name, name, ipAddresses: ["10.0.0.1"] }),
    );
    credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "SSH", payload: {} });
    connectorRegistry.require.mockReturnValue({
      executeCommand: jest.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    });
    prisma.infraCommandRun.create.mockResolvedValue({ id: "run1" });
    prisma.infraCommandRun.update.mockImplementation(({ data }) => ({ id: "run1", ...data }));

    const results = await service.executeOnGroup("env1", "user:u1", ["good-host", "bad-host"], "uptime");

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("SUCCEEDED");
    expect(results[1]).toMatchObject({ status: "FAILED", targetLabel: "bad-host" });
  });
});
