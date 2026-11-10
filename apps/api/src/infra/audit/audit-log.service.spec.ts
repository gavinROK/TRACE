import { AuditLogService } from "./audit-log.service";

describe("AuditLogService", () => {
  const prisma = { infraAuditLogEntry: { create: jest.fn(), findMany: jest.fn() } };
  const service = new AuditLogService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it("records an entry with the given fields", async () => {
    await service.record({
      environmentId: "env1",
      actor: "user:u1",
      action: "credential.create",
      outcome: "success",
      detail: { label: "beelink-ssh" },
    });

    expect(prisma.infraAuditLogEntry.create).toHaveBeenCalledWith({
      data: {
        environmentId: "env1",
        actor: "user:u1",
        action: "credential.create",
        targetType: undefined,
        targetId: undefined,
        outcome: "success",
        detail: { label: "beelink-ssh" },
      },
    });
  });

  it("lists the most recent entries for an environment, newest first", async () => {
    prisma.infraAuditLogEntry.findMany.mockResolvedValue([]);

    await service.listForEnvironment("env1", 50);

    expect(prisma.infraAuditLogEntry.findMany).toHaveBeenCalledWith({
      where: { environmentId: "env1" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });
});
