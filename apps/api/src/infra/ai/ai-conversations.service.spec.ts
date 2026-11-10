import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { AiConversationsService } from "./ai-conversations.service";

describe("AiConversationsService", () => {
  const prisma = {
    aiConversation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    aiMessage: { create: jest.fn() },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const service = new AiConversationsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it("start creates a conversation owned by the given actor", async () => {
    prisma.aiConversation.create.mockResolvedValue({ id: "c1" });
    await service.start({ environmentId: "env1", actor: "user:u1" });
    expect(prisma.aiConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ environmentId: "env1", actor: "user:u1" }) }),
    );
  });

  it("list only returns conversations scoped to (environmentId, actor)", async () => {
    prisma.aiConversation.findMany.mockResolvedValue([]);
    await service.list("env1", "user:u1");
    expect(prisma.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { environmentId: "env1", actor: "user:u1" } }),
    );
  });

  it("assertOwned throws ForbiddenException when a different user owns the conversation", async () => {
    prisma.aiConversation.findFirst.mockResolvedValue({ actor: "user:owner" });
    await expect(service.assertOwned("env1", "user:intruder", "c1")).rejects.toThrow(ForbiddenException);
  });

  it("assertOwned throws NotFoundException for a conversation that doesn't exist", async () => {
    prisma.aiConversation.findFirst.mockResolvedValue(null);
    await expect(service.assertOwned("env1", "user:u1", "missing")).rejects.toThrow(NotFoundException);
  });

  it("assertOwned passes silently for the real owner", async () => {
    prisma.aiConversation.findFirst.mockResolvedValue({ actor: "user:u1" });
    await expect(service.assertOwned("env1", "user:u1", "c1")).resolves.toBeUndefined();
  });

  it("remove refuses to delete a conversation owned by someone else", async () => {
    prisma.aiConversation.findFirst.mockResolvedValue({ actor: "user:owner" });
    await expect(service.remove("env1", "user:intruder", "c1")).rejects.toThrow(ForbiddenException);
    expect(prisma.aiConversation.delete).not.toHaveBeenCalled();
  });

  it("remove deletes the conversation once ownership is confirmed", async () => {
    prisma.aiConversation.findFirst.mockResolvedValue({ actor: "user:u1" });
    await service.remove("env1", "user:u1", "c1");
    expect(prisma.aiConversation.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("appendMessage persists role/content/tool records and bumps updatedAt", async () => {
    prisma.aiMessage.create.mockResolvedValue({ id: "m1" });
    prisma.aiConversation.update.mockResolvedValue({});
    const saved = await service.appendMessage("c1", {
      role: "ASSISTANT" as never,
      content: "hello",
      toolCalls: [{ name: "list_devices", input: {} }],
      toolResults: [{ name: "list_devices", output: [], isError: false }],
    });
    expect(saved).toEqual({ id: "m1" });
    expect(prisma.aiMessage.create).toHaveBeenCalled();
    expect(prisma.aiConversation.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { updatedAt: expect.any(Date) } });
  });
});
