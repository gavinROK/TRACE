import { TopologyService } from "./topology.service";

describe("TopologyService", () => {
  const prisma = { infraDevice: { findMany: jest.fn() }, infraRelationship: { findMany: jest.fn() } };
  const devicesService = { getDashboardSummary: jest.fn() };
  const service = new TopologyService(prisma as never, devicesService as never);

  it("assembles nodes, edges (tagged VERIFIED/INFERRED), and the dashboard summary", async () => {
    prisma.infraDevice.findMany.mockResolvedValue([
      { id: "d1", name: "beelink", category: "PHYSICAL_SERVER", onlineState: "ONLINE", enrollmentStatus: "ENROLLED", parentDeviceId: null },
      { id: "d2", name: "pihole", category: "CONTAINER", onlineState: "ONLINE", enrollmentStatus: "DISCOVERED", parentDeviceId: "d1" },
    ]);
    prisma.infraRelationship.findMany.mockResolvedValue([
      { id: "r1", fromDeviceId: "d1", toDeviceId: "d2", type: "HOSTS", kind: "VERIFIED" },
    ]);
    devicesService.getDashboardSummary.mockResolvedValue({ totalDevices: 2, onlineDevices: 2, offlineDevices: 0, unknownStateDevices: 0 });

    const snapshot = await service.getSnapshot("env1");

    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.edges).toEqual([{ id: "r1", from: "d1", to: "d2", type: "HOSTS", kind: "VERIFIED" }]);
    expect(snapshot.summary.totalDevices).toBe(2);
  });
});
