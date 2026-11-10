import { AiActionClassification } from "@prisma/client";
import { ActionsController } from "./actions.controller";

function fakeReq(actor: string) {
  return { actor } as never;
}

describe("ActionsController — MCP approval gating", () => {
  const actionsService = { performAction: jest.fn() };
  const approvals = { create: jest.fn() };
  const controller = new ActionsController(actionsService as never, approvals as never);

  beforeEach(() => jest.clearAllMocks());

  it("a real user session performing 'start' runs directly (unchanged)", async () => {
    actionsService.performAction.mockResolvedValue({ success: true });

    const result = await controller.perform(fakeReq("user:u1"), "env1", "d1", { action: "start" } as never);

    expect(actionsService.performAction).toHaveBeenCalledWith("env1", "user:u1", "d1", "start", undefined, false);
    expect(approvals.create).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("a real user session performing 'stop' with confirm:true still runs directly (unchanged)", async () => {
    actionsService.performAction.mockResolvedValue({ success: true });

    await controller.perform(fakeReq("user:u1"), "env1", "d1", { action: "stop", confirm: true } as never);

    expect(actionsService.performAction).toHaveBeenCalledWith("env1", "user:u1", "d1", "stop", undefined, true);
  });

  it("the MCP actor requesting 'start' creates an ADMINISTRATIVE pending action, never executes directly", async () => {
    approvals.create.mockResolvedValue({ id: "pa1" });

    const result = await controller.perform(fakeReq("claude-mcp"), "env1", "d1", { action: "start" } as never);

    expect(actionsService.performAction).not.toHaveBeenCalled();
    expect(approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "perform_action", toolInput: { deviceId: "d1", action: "start", params: undefined }, classification: AiActionClassification.ADMINISTRATIVE, requestedBy: "claude-mcp" }),
    );
    expect(result).toEqual(expect.objectContaining({ pending: true, pendingActionId: "pa1", classification: AiActionClassification.ADMINISTRATIVE }));
  });

  it("the MCP actor requesting 'stop' creates a DESTRUCTIVE pending action, even with confirm:true set", async () => {
    approvals.create.mockResolvedValue({ id: "pa2" });

    const result = await controller.perform(fakeReq("claude-mcp"), "env1", "d1", { action: "stop", confirm: true } as never);

    expect(actionsService.performAction).not.toHaveBeenCalled();
    expect(approvals.create).toHaveBeenCalledWith(expect.objectContaining({ classification: AiActionClassification.DESTRUCTIVE }));
    expect(result).toEqual(expect.objectContaining({ pending: true, pendingActionId: "pa2", classification: AiActionClassification.DESTRUCTIVE }));
  });
});
