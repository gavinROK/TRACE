import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ProxmoxDiscoveryService } from "./proxmox-discovery.service";

describe("ProxmoxDiscoveryService", () => {
  const prisma = {
    infraDevice: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    infraRelationship: { upsert: jest.fn() },
  };
  const connectorRegistry = { require: jest.fn() };
  const credentialsService = { getDecryptedForDevice: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new ProxmoxDiscoveryService(prisma as never, connectorRegistry as never, credentialsService as never, auditLog as never);

  beforeEach(() => jest.clearAllMocks());

  it("throws NotFoundException for a hypervisor device outside the environment", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue(null);

    await expect(service.discoverFromHypervisor("env1", "user:u1", "missing")).rejects.toThrow(NotFoundException);
  });

  it("throws when the hypervisor has no credential enrolled", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "hv1", ipAddresses: ["10.0.0.2"] });
    credentialsService.getDecryptedForDevice.mockResolvedValue(undefined);

    await expect(service.discoverFromHypervisor("env1", "user:u1", "hv1")).rejects.toThrow(BadRequestException);
  });

  it("skips the node itself and creates new devices for VMs/containers", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "hv1", name: "beelink", ipAddresses: ["10.0.0.2"] });
    credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "PROXMOX_API", payload: {} });
    connectorRegistry.require.mockReturnValue({
      discover: jest.fn().mockResolvedValue([
        { name: "beelink", host: "10.0.0.2", category: "PHYSICAL_SERVER" },
        { name: "ubuntu-server", host: "10.0.0.2", category: "VIRTUAL_MACHINE", metadata: { vmid: 101 } },
        { name: "pihole", host: "10.0.0.2", category: "CONTAINER", metadata: { vmid: 201 } },
      ]),
    });
    prisma.infraDevice.findUnique.mockResolvedValue(null);
    prisma.infraDevice.create.mockImplementation(({ data }) => ({ id: `new-${data.name}`, ...data }));

    const result = await service.discoverFromHypervisor("env1", "user:u1", "hv1");

    expect(result).toEqual({ created: 2, updated: 0, totalDiscovered: 2 });
    expect(prisma.infraDevice.create).toHaveBeenCalledTimes(2);
    expect(prisma.infraRelationship.upsert).toHaveBeenCalledTimes(2);
  });

  it("updates an existing device in place rather than duplicating it", async () => {
    prisma.infraDevice.findFirst.mockResolvedValue({ id: "hv1", name: "beelink", ipAddresses: ["10.0.0.2"] });
    credentialsService.getDecryptedForDevice.mockResolvedValue({ protocol: "PROXMOX_API", payload: {} });
    connectorRegistry.require.mockReturnValue({
      discover: jest.fn().mockResolvedValue([
        { name: "ubuntu-server", host: "10.0.0.2", category: "VIRTUAL_MACHINE", metadata: { vmid: 101 } },
      ]),
    });
    prisma.infraDevice.findUnique.mockResolvedValue({ id: "existing-vm" });
    prisma.infraDevice.update.mockResolvedValue({ id: "existing-vm" });

    const result = await service.discoverFromHypervisor("env1", "user:u1", "hv1");

    expect(result).toEqual({ created: 0, updated: 1, totalDiscovered: 1 });
    expect(prisma.infraDevice.create).not.toHaveBeenCalled();
  });
});
