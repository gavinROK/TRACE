import { BadRequestException } from "@nestjs/common";
import { NetworkDiscoveryService } from "./network-discovery.service";

const execFileMock = jest.fn();
jest.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));
jest.mock("node:os", () => ({
  networkInterfaces: jest.fn(() => ({
    en0: [{ address: "192.168.1.50", family: "IPv4", mac: "aa:bb:cc:dd:ee:ff", internal: false, cidr: "192.168.1.50/24" }],
    lo0: [{ address: "127.0.0.1", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }],
  })),
}));

function mockExecOnce(result: { stdout?: string; stderr?: string } | Error) {
  execFileMock.mockImplementationOnce((...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: Error | null, result?: { stdout: string; stderr: string }) => void;
    if (result instanceof Error) callback(result);
    else callback(null, { stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
  });
}

describe("NetworkDiscoveryService", () => {
  const service = new NetworkDiscoveryService();

  beforeEach(() => execFileMock.mockReset());

  it("lists local interfaces from the real OS network stack, including internal ones", () => {
    const interfaces = service.listLocalInterfaces();

    expect(interfaces).toEqual([
      { name: "en0", address: "192.168.1.50", family: "IPv4", mac: "aa:bb:cc:dd:ee:ff", internal: false, cidr: "192.168.1.50/24" },
      { name: "lo0", address: "127.0.0.1", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" },
    ]);
  });

  it("parses the default gateway from `route -n get default`", async () => {
    mockExecOnce({
      stdout: "   route to: default\ndestination: default\n       mask: default\n    gateway: 192.168.0.1\n  interface: en0\n",
    });

    await expect(service.getDefaultGateway()).resolves.toBe("192.168.0.1");
  });

  it("returns undefined (not throwing) when there is no default route", async () => {
    mockExecOnce(new Error("route: writing to routing socket: not in table"));

    await expect(service.getDefaultGateway()).resolves.toBeUndefined();
  });

  it("parses macOS arp -a output into ip/mac/interface rows", async () => {
    mockExecOnce({
      stdout: "router.home (192.168.1.1) at a1:b2:c3:d4:e5:f6 on en0 ifscope [ethernet]\nincomplete (192.168.1.99) at (incomplete) on en0 ifscope [ethernet]\n",
    });

    const neighbors = await service.listArpNeighbors();

    expect(neighbors).toEqual([{ ip: "192.168.1.1", mac: "a1:b2:c3:d4:e5:f6", interface: "en0" }]);
  });

  it("rejects an invalid IP before shelling out to ping", async () => {
    await expect(service.checkReachability("not-an-ip")).rejects.toThrow(BadRequestException);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("reports unreachable (false) rather than throwing when ping fails", async () => {
    mockExecOnce(new Error("ping: timeout"));

    await expect(service.checkReachability("10.0.0.99")).resolves.toBe(false);
  });

  it("reports reachable (true) when ping succeeds", async () => {
    mockExecOnce({ stdout: "1 packets transmitted, 1 received" });

    await expect(service.checkReachability("10.0.0.1")).resolves.toBe(true);
  });

  it("rejects an invalid CIDR before checking for nmap", async () => {
    await expect(service.runNmapPingSweep("not-a-cidr")).rejects.toThrow(BadRequestException);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("gives a clear error when nmap is not installed, rather than attempting to install it", async () => {
    mockExecOnce(new Error("which: nmap not found"));

    await expect(service.runNmapPingSweep("192.168.1.0/24")).rejects.toThrow(/nmap is not installed/);
  });

  it("parses nmap -sn output into a list of live hosts", async () => {
    mockExecOnce({ stdout: "" }); // `which nmap` succeeds
    mockExecOnce({
      stdout: "Nmap scan report for 192.168.1.1\nNmap scan report for beelink (192.168.1.20)\n",
    });

    const hosts = await service.runNmapPingSweep("192.168.1.0/24");

    expect(hosts).toEqual(["192.168.1.1", "192.168.1.20"]);
    expect(execFileMock.mock.calls[1][0]).toBe("nmap");
    expect(execFileMock.mock.calls[1][1]).toEqual(["-sn", "192.168.1.0/24"]);
  });
});
