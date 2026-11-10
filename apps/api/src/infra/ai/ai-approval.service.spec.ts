import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AiActionClassification, AiPendingActionStatus } from "@prisma/client";
import { AiApprovalService } from "./ai-approval.service";

describe("AiApprovalService", () => {
  const prisma = {
    aiPendingAction: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const auditLog = { record: jest.fn() };
  const service = new AiApprovalService(prisma as never, auditLog as never);

  beforeEach(() => jest.clearAllMocks());

  it("create persists a PENDING row and audits it as 'proposed'", async () => {
    prisma.aiPendingAction.create.mockResolvedValue({ id: "pa1" });

    await service.create({
      conversationId: "c1",
      environmentId: "env1",
      toolName: "execute_command",
      toolInput: { deviceName: "beelink", command: "rm -rf /" },
      classification: AiActionClassification.ADMINISTRATIVE,
      requestedBy: "user:u1",
    });

    expect(prisma.aiPendingAction.create).toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.tool.execute_command.proposed", outcome: "success" }));
  });

  it("create redacts anything secret-shaped out of the persisted toolInput", async () => {
    prisma.aiPendingAction.create.mockResolvedValue({ id: "pa1" });
    await service.create({
      conversationId: "c1",
      environmentId: "env1",
      toolName: "update_device",
      toolInput: { deviceId: "d1", notes: "password: hunter2secretvalue" },
      classification: AiActionClassification.ADMINISTRATIVE,
      requestedBy: "user:u1",
    });
    const written = prisma.aiPendingAction.create.mock.calls[0][0].data.toolInput;
    expect(JSON.stringify(written)).not.toContain("hunter2secretvalue");
  });

  it("the AI/MCP service-token identity can never decide its own pending action", async () => {
    prisma.aiPendingAction.findFirst.mockResolvedValue({
      id: "pa1",
      status: AiPendingActionStatus.PENDING,
      toolName: "execute_command",
      toolInput: {},
      classification: AiActionClassification.ADMINISTRATIVE,
      conversationId: "c1",
    });

    await expect(service.decide("env1", "pa1", "claude-mcp", true)).rejects.toThrow(ForbiddenException);
    expect(prisma.aiPendingAction.update).not.toHaveBeenCalled();
  });

  it("a real user decision marks the action APPROVED and audits who decided", async () => {
    prisma.aiPendingAction.findFirst.mockResolvedValue({
      id: "pa1",
      status: AiPendingActionStatus.PENDING,
      toolName: "perform_action",
      toolInput: { deviceId: "d1", action: "stop" },
      classification: AiActionClassification.DESTRUCTIVE,
      conversationId: "c1",
    });

    const result = await service.decide("env1", "pa1", "user:u1", true);

    expect(result.toolName).toBe("perform_action");
    expect(prisma.aiPendingAction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: AiPendingActionStatus.APPROVED, decidedBy: "user:u1" }) }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.tool.perform_action.approved" }));
  });

  it("rejects deciding an already-decided action a second time", async () => {
    prisma.aiPendingAction.findFirst.mockResolvedValue({
      id: "pa1",
      status: AiPendingActionStatus.APPROVED,
      toolName: "perform_action",
      toolInput: {},
      classification: AiActionClassification.DESTRUCTIVE,
      conversationId: "c1",
    });
    await expect(service.decide("env1", "pa1", "user:u1", true)).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException for a pending action outside the environment", async () => {
    prisma.aiPendingAction.findFirst.mockResolvedValue(null);
    await expect(service.get("env1", "missing")).rejects.toThrow(NotFoundException);
  });
});
