import { AiActionClassification, AiMessageRole } from "@prisma/client";
import { AiChatService } from "./ai-chat.service";
import type { AiStreamEvent } from "./providers/ai-provider.interface";

async function* streamOf(events: AiStreamEvent[]): AsyncIterable<AiStreamEvent> {
  for (const event of events) yield event;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("AiChatService", () => {
  const settings = { getApiKey: jest.fn(), getSelectedModelOrDefault: jest.fn().mockResolvedValue("claude-sonnet-5") };
  const provider = { streamMessage: jest.fn() };
  const conversations = {
    appendMessage: jest.fn().mockResolvedValue({ id: "m1" }),
    setTitleIfUnset: jest.fn(),
    getWithMessages: jest.fn().mockResolvedValue({ messages: [], deviceContextId: null, deviceContextName: null }),
  };
  const tools = { run: jest.fn() };
  const approvals = { create: jest.fn(), decide: jest.fn(), recordResult: jest.fn() };

  const service = new AiChatService(settings as never, provider as never, conversations as never, tools as never, approvals as never);

  beforeEach(() => jest.clearAllMocks());

  const baseParams = { environmentId: "env1", actor: "user:u1", conversationId: "c1", userMessage: "hi" };

  it("explains the missing-API-key limitation instead of attempting a provider call", async () => {
    settings.getApiKey.mockResolvedValue(undefined);

    const events = await collect(service.sendMessage(baseParams));

    expect(provider.streamMessage).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ type: "error", retryable: false });
    expect((events[0] as { message: string }).message).toContain("Settings");
    expect(events.at(-1)).toMatchObject({ type: "done", messageId: null });
  });

  it("streams text deltas and persists the final assistant message with usage/cost", async () => {
    settings.getApiKey.mockResolvedValue("sk-ant-real-key");
    provider.streamMessage.mockReturnValue(
      streamOf([
        { type: "text_delta", text: "The " },
        { type: "text_delta", text: "Beelink is online." },
        { type: "usage", inputTokens: 100, outputTokens: 20 },
        { type: "message_stop", stopReason: "end_turn" },
      ]),
    );

    const events = await collect(service.sendMessage(baseParams));

    const text = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(text).toBe("The Beelink is online.");
    const usage = events.find((e) => e.type === "usage") as { inputTokens: number; outputTokens: number; estimatedCostUsd: number | null };
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(20);
    expect(usage.estimatedCostUsd).toBeGreaterThan(0); // claude-sonnet-5 has a known fallback price
    expect(conversations.appendMessage).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ role: AiMessageRole.ASSISTANT, content: "The Beelink is online." }),
    );
  });

  it("auto-executes a READ_ONLY tool call and feeds the result back for a second provider turn", async () => {
    settings.getApiKey.mockResolvedValue("sk-ant-real-key");
    tools.run.mockResolvedValue([{ id: "d1", name: "beelink", onlineState: "ONLINE" }]);
    provider.streamMessage
      .mockReturnValueOnce(
        streamOf([
          { type: "tool_use", id: "tu1", name: "list_devices", input: {} },
          { type: "message_stop", stopReason: "tool_use" },
        ]),
      )
      .mockReturnValueOnce(
        streamOf([
          { type: "text_delta", text: "You have one device: beelink, online." },
          { type: "message_stop", stopReason: "end_turn" },
        ]),
      );

    const events = await collect(service.sendMessage(baseParams));

    expect(tools.run).toHaveBeenCalledWith("list_devices", {}, { environmentId: "env1", actor: "user:u1" });
    expect(approvals.create).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_call", name: "list_devices" }),
        expect.objectContaining({ type: "tool_result", name: "list_devices", isError: false }),
      ]),
    );
    expect(provider.streamMessage).toHaveBeenCalledTimes(2);
    const finalText = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(finalText).toBe("You have one device: beelink, online.");
  });

  it("does NOT execute an ADMINISTRATIVE tool call — it creates a pending approval instead", async () => {
    settings.getApiKey.mockResolvedValue("sk-ant-real-key");
    approvals.create.mockResolvedValue({ id: "pa1" });
    provider.streamMessage.mockReturnValueOnce(
      streamOf([
        { type: "tool_use", id: "tu1", name: "execute_command", input: { deviceName: "beelink", command: "reboot" } },
        { type: "message_stop", stopReason: "tool_use" },
      ]),
    );
    // No second queued stream — if the service wrongly called the
    // provider a second time before approval, this would throw.
    provider.streamMessage.mockReturnValueOnce(streamOf([{ type: "message_stop", stopReason: "end_turn" }]));

    const events = await collect(service.sendMessage(baseParams));

    expect(tools.run).not.toHaveBeenCalled();
    expect(approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "execute_command", classification: AiActionClassification.ADMINISTRATIVE }),
    );
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "pending_approval", pendingActionId: "pa1" })]));
  });

  it("classifies a destructive perform_action(stop) as DESTRUCTIVE when gating for approval", async () => {
    settings.getApiKey.mockResolvedValue("sk-ant-real-key");
    approvals.create.mockResolvedValue({ id: "pa2" });
    provider.streamMessage.mockReturnValueOnce(
      streamOf([
        { type: "tool_use", id: "tu1", name: "perform_action", input: { deviceId: "d1", action: "stop" } },
        { type: "message_stop", stopReason: "tool_use" },
      ]),
    );
    provider.streamMessage.mockReturnValueOnce(streamOf([{ type: "message_stop", stopReason: "end_turn" }]));

    await collect(service.sendMessage(baseParams));

    expect(approvals.create).toHaveBeenCalledWith(expect.objectContaining({ classification: AiActionClassification.DESTRUCTIVE }));
  });

  it("surfaces a provider error event without crashing the stream", async () => {
    settings.getApiKey.mockResolvedValue("sk-ant-real-key");
    provider.streamMessage.mockReturnValue(streamOf([{ type: "error", message: "rate limited", retryable: true }]));

    const events = await collect(service.sendMessage(baseParams));

    expect(events).toEqual(expect.arrayContaining([{ type: "error", message: "rate limited", retryable: true }]));
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  describe("resolveApproval", () => {
    it("executes the approved tool via the shared registry and records the result", async () => {
      approvals.decide.mockResolvedValue({ toolName: "perform_action", toolInput: { deviceId: "d1", action: "stop" }, conversationId: "c1" });
      tools.run.mockResolvedValue({ success: true });

      const result = await service.resolveApproval("env1", "pa1", "user:u1", true);

      expect(approvals.decide).toHaveBeenCalledWith("env1", "pa1", "user:u1", true);
      expect(tools.run).toHaveBeenCalledWith("perform_action", { deviceId: "d1", action: "stop" }, { environmentId: "env1", actor: "user:u1" });
      expect(approvals.recordResult).toHaveBeenCalledWith("pa1", { output: { success: true }, isError: false });
      expect(result).toEqual({ status: "executed", output: { success: true }, isError: false });
    });

    it("does not execute anything on rejection", async () => {
      approvals.decide.mockResolvedValue({ toolName: "execute_command", toolInput: {}, conversationId: "c1" });

      const result = await service.resolveApproval("env1", "pa1", "user:u1", false);

      expect(tools.run).not.toHaveBeenCalled();
      expect(result).toEqual({ status: "rejected" });
    });

    it("works for an MCP-originated pending action with no conversation to append a message to", async () => {
      approvals.decide.mockResolvedValue({ toolName: "perform_action", toolInput: { deviceId: "d1", action: "start" }, conversationId: null });
      tools.run.mockResolvedValue({ success: true });

      const result = await service.resolveApproval("env1", "pa1", "user:u1", true);

      expect(result).toEqual({ status: "executed", output: { success: true }, isError: false });
      expect(conversations.appendMessage).not.toHaveBeenCalled();
    });
  });
});
