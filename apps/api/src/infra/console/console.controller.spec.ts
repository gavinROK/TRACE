import { BadRequestException } from "@nestjs/common";
import { AiActionClassification } from "@prisma/client";
import { ConsoleController } from "./console.controller";

function fakeReq(actor: string) {
  return { actor } as never;
}

describe("ConsoleController — MCP approval gating", () => {
  const commandExecution = { executeOnDevice: jest.fn(), executeOnGroup: jest.fn() };
  const approvals = { create: jest.fn() };
  const controller = new ConsoleController(commandExecution as never, approvals as never);

  beforeEach(() => jest.clearAllMocks());

  it("exec: a real user session runs the command directly, exactly as before", async () => {
    commandExecution.executeOnDevice.mockResolvedValue({ status: "SUCCEEDED" });

    const result = await controller.exec(fakeReq("user:u1"), "env1", { deviceName: "beelink", command: "uptime" } as never);

    expect(commandExecution.executeOnDevice).toHaveBeenCalledWith("env1", "user:u1", "beelink", "uptime", undefined);
    expect(approvals.create).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "SUCCEEDED" });
  });

  it("exec: the MCP actor never runs the command directly — it creates a pending approval instead", async () => {
    approvals.create.mockResolvedValue({ id: "pa1" });

    const result = await controller.exec(fakeReq("claude-mcp"), "env1", { deviceName: "beelink", command: "rm -rf /" } as never);

    expect(commandExecution.executeOnDevice).not.toHaveBeenCalled();
    expect(approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: "env1",
        toolName: "execute_command",
        toolInput: { deviceName: "beelink", command: "rm -rf /", timeoutMs: undefined },
        classification: AiActionClassification.ADMINISTRATIVE,
        requestedBy: "claude-mcp",
      }),
    );
    expect(result).toEqual(expect.objectContaining({ pending: true, pendingActionId: "pa1" }));
  });

  it("exec-group: a real user session with >1 device still requires confirm:true (unchanged behavior)", async () => {
    await expect(
      controller.execGroup(fakeReq("user:u1"), "env1", { deviceNames: ["a", "b"], command: "uptime", confirm: false } as never),
    ).rejects.toThrow(BadRequestException);
    expect(commandExecution.executeOnGroup).not.toHaveBeenCalled();
  });

  it("exec-group: the MCP actor is gated regardless of confirm or device count", async () => {
    approvals.create.mockResolvedValue({ id: "pa2" });

    const result = await controller.execGroup(fakeReq("claude-mcp"), "env1", { deviceNames: ["a", "b"], command: "reboot", confirm: true } as never);

    expect(commandExecution.executeOnGroup).not.toHaveBeenCalled();
    expect(approvals.create).toHaveBeenCalledWith(expect.objectContaining({ toolName: "execute_group_command", classification: AiActionClassification.ADMINISTRATIVE }));
    expect(result).toEqual(expect.objectContaining({ pending: true, pendingActionId: "pa2" }));
  });
});
