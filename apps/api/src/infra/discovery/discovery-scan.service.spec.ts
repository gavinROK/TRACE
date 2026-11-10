import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { DiscoveryScanService } from "./discovery-scan.service";

describe("DiscoveryScanService", () => {
  const prisma = { infraDevice: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() } };
  const networkDiscovery = {
    listLocalInterfaces: jest.fn(),
    getDefaultGateway: jest.fn(),
    listArpNeighbors: jest.fn(),
    runNmapPingSweep: jest.fn(),
    probeTcpPort: jest.fn(),
  };
  const devicesService = { update: jest.fn(), create: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new DiscoveryScanService(prisma as never, networkDiscovery as never, devicesService as never, auditLog as never);

  beforeEach(() => jest.clearAllMocks());

  describe("detectLocalNetwork", () => {
    it("picks the first non-internal IPv4 interface and the default gateway", async () => {
      networkDiscovery.listLocalInterfaces.mockReturnValue([
        { name: "lo0", address: "127.0.0.1", family: "IPv4", internal: true, mac: "00:00:00:00:00:00", cidr: "127.0.0.1/8" },
        { name: "en0", address: "192.168.0.126", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:ff", cidr: "192.168.0.126/24" },
      ]);
      networkDiscovery.getDefaultGateway.mockResolvedValue("192.168.0.1");

      const result = await service.detectLocalNetwork();

      expect(result).toEqual({
        interfaceName: "en0",
        localAddress: "192.168.0.126",
        subnetCidr: "192.168.0.126/24",
        gateway: "192.168.0.1",
      });
    });
  });

  describe("scanSubnet", () => {
    beforeEach(() => {
      networkDiscovery.listLocalInterfaces.mockReturnValue([
        { name: "en0", address: "192.168.0.126", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:ff", cidr: "192.168.0.126/24" },
      ]);
      networkDiscovery.getDefaultGateway.mockResolvedValue("192.168.0.1");
      prisma.infraDevice.findMany.mockResolvedValue([]);
    });

    it("throws when no subnet can be determined and none was provided", async () => {
      networkDiscovery.listLocalInterfaces.mockReturnValue([]);
      networkDiscovery.getDefaultGateway.mockResolvedValue(undefined);

      await expect(service.scanSubnet("env1")).rejects.toThrow(BadRequestException);
    });

    it("labels the default gateway a ROUTER candidate", async () => {
      networkDiscovery.listArpNeighbors.mockResolvedValue([{ ip: "192.168.0.1", mac: "11:22:33:44:55:66" }]);
      networkDiscovery.runNmapPingSweep.mockRejectedValue(new Error("nmap not installed"));

      const result = await service.scanSubnet("env1");

      expect(result.candidates).toEqual([
        expect.objectContaining({ ip: "192.168.0.1", isGateway: true, suggestedCategory: "ROUTER" }),
      ]);
      expect(result.usedNmap).toBe(false);
    });

    it("labels a NETGEAR MAC prefix a MANAGED_SWITCH candidate", async () => {
      networkDiscovery.listArpNeighbors.mockResolvedValue([{ ip: "192.168.0.5", mac: "A0:40:A0:11:22:33" }]);
      networkDiscovery.runNmapPingSweep.mockRejectedValue(new Error("nmap not installed"));

      const result = await service.scanSubnet("env1");

      expect(result.candidates[0]).toMatchObject({ vendorGuess: "NETGEAR", suggestedCategory: "MANAGED_SWITCH" });
    });

    it("flags a candidate already in inventory instead of treating it as new", async () => {
      prisma.infraDevice.findMany.mockResolvedValue([{ id: "d1", name: "beelink", ipAddresses: ["192.168.0.70"] }]);
      networkDiscovery.listArpNeighbors.mockResolvedValue([{ ip: "192.168.0.70", mac: "bc:24:11:aa:bb:cc" }]);
      networkDiscovery.runNmapPingSweep.mockRejectedValue(new Error("nmap not installed"));

      const result = await service.scanSubnet("env1");

      expect(result.candidates[0]).toMatchObject({ alreadyKnown: true, existingDeviceId: "d1", existingDeviceName: "beelink" });
    });

    it("merges nmap-only hosts in without duplicating ones already seen via ARP", async () => {
      networkDiscovery.listArpNeighbors.mockResolvedValue([{ ip: "192.168.0.1", mac: "11:22:33:44:55:66" }]);
      networkDiscovery.runNmapPingSweep.mockResolvedValue(["192.168.0.1", "192.168.0.50"]);

      const result = await service.scanSubnet("env1");

      expect(result.usedNmap).toBe(true);
      expect(result.candidates.map((c) => c.ip).sort()).toEqual(["192.168.0.1", "192.168.0.50"]);
    });
  });

  describe("importCandidate", () => {
    it("creates a new device and tags its discoverySource", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue(null);
      devicesService.create.mockResolvedValue({ id: "new1", name: "Router" });
      prisma.infraDevice.update.mockResolvedValue({ id: "new1", name: "Router", discoverySource: "discovery:scan" });

      const result = await service.importCandidate("env1", "user:u1", {
        ip: "192.168.0.1",
        mac: "11:22:33:44:55:66",
        name: "Router",
        category: "ROUTER" as never,
      });

      expect(result.action).toBe("created");
      expect(devicesService.create).toHaveBeenCalledWith("env1", expect.objectContaining({ name: "Router", ipAddresses: ["192.168.0.1"] }));
      expect(prisma.infraDevice.update).toHaveBeenCalledWith({ where: { id: "new1" }, data: { discoverySource: "discovery:scan" } });
    });

    it("merges into an existing device matched by IP instead of creating a duplicate", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "existing1", macAddresses: [] });
      devicesService.update.mockResolvedValue({ id: "existing1", macAddresses: ["11:22:33:44:55:66"] });

      const result = await service.importCandidate("env1", "user:u1", {
        ip: "192.168.0.1",
        mac: "11:22:33:44:55:66",
        name: "Router",
        category: "ROUTER" as never,
      });

      expect(result.action).toBe("merged");
      expect(devicesService.create).not.toHaveBeenCalled();
      expect(devicesService.update).toHaveBeenCalledWith("env1", "existing1", "user:u1", { macAddresses: ["11:22:33:44:55:66"] });
    });
  });

  describe("assertAuthorizedTarget", () => {
    beforeEach(() => {
      networkDiscovery.listLocalInterfaces.mockReturnValue([
        { name: "en0", address: "192.168.0.126", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:ff", cidr: "192.168.0.126/24" },
      ]);
      networkDiscovery.getDefaultGateway.mockResolvedValue("192.168.0.1");
    });

    it("allows an IP within TRACE's own detected subnet", async () => {
      await expect(service.assertAuthorizedTarget("192.168.0.1")).resolves.toBeUndefined();
    });

    it("refuses an IP outside TRACE's own detected subnet", async () => {
      await expect(service.assertAuthorizedTarget("10.0.0.1")).rejects.toThrow(ForbiddenException);
    });

    it("refuses everything when no local subnet could be detected at all", async () => {
      networkDiscovery.listLocalInterfaces.mockReturnValue([]);
      networkDiscovery.getDefaultGateway.mockResolvedValue(undefined);

      await expect(service.assertAuthorizedTarget("192.168.0.1")).rejects.toThrow(ForbiddenException);
    });
  });

  describe("probeManagementPorts", () => {
    it("probes the curated port list and reports a protocol hint per port", async () => {
      networkDiscovery.probeTcpPort.mockImplementation(async (_ip: string, port: number) => port === 22);

      const result = await service.probeManagementPorts("192.168.0.1");

      expect(result).toEqual(
        expect.arrayContaining([
          { port: 22, open: true, protocolHint: "SSH" },
          { port: 8006, open: false, protocolHint: "PROXMOX_API" },
        ]),
      );
    });

    it("never probes SNMP's port — UDP makes a TCP-connect result meaningless", async () => {
      networkDiscovery.probeTcpPort.mockResolvedValue(false);

      const result = await service.probeManagementPorts("192.168.0.1");

      expect(result.some((r) => r.port === 161)).toBe(false);
    });
  });
});
