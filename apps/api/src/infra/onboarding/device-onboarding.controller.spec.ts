import { AiActionClassification } from "@prisma/client";
import { DeviceOnboardingController } from "./device-onboarding.controller";

function fakeReq(actor: string) {
  return { actor } as never;
}

describe("DeviceOnboardingController — actor gating", () => {
  const onboarding = { configure: jest.fn(), verify: jest.fn() };
  const approvals = { create: jest.fn() };
  const controller = new DeviceOnboardingController(onboarding as never, approvals as never);

  beforeEach(() => jest.clearAllMocks());

  describe("configure", () => {
    it("a real browser session configures directly, same as update_device", async () => {
      onboarding.configure.mockResolvedValue({ device: { id: "d1" } });

      const result = await controller.configure(fakeReq("user:u1"), "env1", { ip: "192.168.0.1" } as never);

      expect(onboarding.configure).toHaveBeenCalledWith("env1", "user:u1", { ip: "192.168.0.1" });
      expect(approvals.create).not.toHaveBeenCalled();
      expect(result).toEqual({ device: { id: "d1" } });
    });

    it("the MCP actor never configures directly — it creates a pending action bound to the exact ip/name/category given", async () => {
      approvals.create.mockResolvedValue({ id: "pa1" });

      const result = await controller.configure(
        fakeReq("claude-mcp"),
        "env1",
        { ip: "192.168.0.1", name: "Router", category: "ROUTER" } as never,
      );

      expect(onboarding.configure).not.toHaveBeenCalled();
      expect(approvals.create).toHaveBeenCalledWith({
        environmentId: "env1",
        toolName: "onboard_device",
        toolInput: { ip: "192.168.0.1", name: "Router", category: "ROUTER" },
        classification: AiActionClassification.ADMINISTRATIVE,
        requestedBy: "claude-mcp",
      });
      expect(result).toEqual(expect.objectContaining({ pending: true, pendingActionId: "pa1" }));
    });
  });

  describe("verify", () => {
    it("runs directly for a browser session — no approval gate", async () => {
      onboarding.verify.mockResolvedValue({ ready: true, onlineState: "ONLINE" });

      const result = await controller.verify(fakeReq("user:u1"), "env1", "d1");

      expect(onboarding.verify).toHaveBeenCalledWith("env1", "d1", "user:u1");
      expect(approvals.create).not.toHaveBeenCalled();
      expect(result).toEqual({ ready: true, onlineState: "ONLINE" });
    });

    it("runs directly for the MCP actor too — it only ever records a real observed connectivity result", async () => {
      onboarding.verify.mockResolvedValue({ ready: true, onlineState: "OFFLINE" });

      const result = await controller.verify(fakeReq("claude-mcp"), "env1", "d1");

      expect(onboarding.verify).toHaveBeenCalledWith("env1", "d1", "claude-mcp");
      expect(approvals.create).not.toHaveBeenCalled();
      expect(result).toEqual({ ready: true, onlineState: "OFFLINE" });
    });
  });
});
