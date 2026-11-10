import { ForbiddenException } from "@nestjs/common";
import { AiController } from "./ai.controller";

function fakeReq(actor: string) {
  return { actor, headers: {}, on: jest.fn() } as never;
}

function fakeRes() {
  return {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
}

describe("AiController — authentication/authorization", () => {
  const settings = { getStatus: jest.fn(), listAvailableModels: jest.fn(), saveApiKey: jest.fn(), clearApiKey: jest.fn(), setSelectedModel: jest.fn() };
  const chat = { sendMessage: jest.fn(), resolveApproval: jest.fn() };
  const conversations = { start: jest.fn(), list: jest.fn(), getWithMessages: jest.fn(), rename: jest.fn(), remove: jest.fn(), assertOwned: jest.fn() };
  const approvals = { listPendingForConversation: jest.fn() };
  const controller = new AiController(settings as never, chat as never, conversations as never, approvals as never);

  beforeEach(() => jest.clearAllMocks());

  it("blocks the MCP service-token actor from reading AI settings", async () => {
    await expect(controller.getSettings(fakeReq("claude-mcp"))).rejects.toThrow(ForbiddenException);
    expect(settings.getStatus).not.toHaveBeenCalled();
  });

  it("blocks the MCP service-token actor from starting a conversation", async () => {
    await expect(controller.startConversation(fakeReq("claude-mcp"), "env1", {})).rejects.toThrow(ForbiddenException);
  });

  it("blocks the MCP service-token actor from sending a message (would otherwise stream)", async () => {
    const res = fakeRes();
    await expect(controller.sendMessage(fakeReq("claude-mcp"), res as never, "env1", "c1", { message: "hi" })).rejects.toThrow(ForbiddenException);
    expect(res.write).not.toHaveBeenCalled();
    expect(conversations.assertOwned).not.toHaveBeenCalled();
  });

  it("blocks the MCP service-token actor from approving a pending action", async () => {
    await expect(controller.approve(fakeReq("claude-mcp"), "env1", "pa1")).rejects.toThrow(ForbiddenException);
    expect(chat.resolveApproval).not.toHaveBeenCalled();
  });

  it("allows a real browser-session actor through to the underlying service", async () => {
    settings.getStatus.mockResolvedValue({ configured: false });
    const result = await controller.getSettings(fakeReq("user:u1"));
    expect(result).toEqual({ configured: false });
  });

  it("a real user's sendMessage checks conversation ownership before opening the stream", async () => {
    conversations.assertOwned.mockResolvedValue(undefined);
    chat.sendMessage.mockReturnValue(
      (async function* () {
        yield { type: "done", messageId: null };
      })(),
    );
    const res = fakeRes();

    await controller.sendMessage(fakeReq("user:u1"), res as never, "env1", "c1", { message: "hi" });

    expect(conversations.assertOwned).toHaveBeenCalledWith("env1", "user:u1", "c1");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(res.end).toHaveBeenCalled();
  });
});
