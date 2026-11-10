import { AiActionClassification } from "@prisma/client";
import { InfraDevicesController } from "./devices.controller";

function fakeReq(actor: string) {
  return { actor } as never;
}

describe("InfraDevicesController.update — MCP approval gating", () => {
  const devicesService = { update: jest.fn() };
  const devicePollingService = {};
  const auditLog = { record: jest.fn() };
  const approvals = { create: jest.fn() };
  const controller = new InfraDevicesController(
    devicesService as never,
    devicePollingService as never,
    auditLog as never,
    approvals as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it("a real user session updates the device directly (unchanged)", async () => {
    devicesService.update.mockResolvedValue({ id: "d1", name: "renamed" });

    const result = await controller.update(fakeReq("user:u1"), "env1", "d1", { name: "renamed" } as never);

    expect(devicesService.update).toHaveBeenCalledWith("env1", "d1", "user:u1", { name: "renamed" });
    expect(approvals.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "d1", name: "renamed" });
  });

  it("the MCP actor's update never writes directly — it creates an ADMINISTRATIVE pending action", async () => {
    approvals.create.mockResolvedValue({ id: "pa1" });

    const result = await controller.update(fakeReq("claude-mcp"), "env1", "d1", { name: "renamed", ipAddresses: ["10.0.0.5"] } as never);

    expect(devicesService.update).not.toHaveBeenCalled();
    expect(approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: "env1",
        toolName: "update_device",
        toolInput: { deviceId: "d1", name: "renamed", ipAddresses: ["10.0.0.5"] },
        classification: AiActionClassification.ADMINISTRATIVE,
        requestedBy: "claude-mcp",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ pending: true, pendingActionId: "pa1", classification: AiActionClassification.ADMINISTRATIVE }),
    );
  });
});
