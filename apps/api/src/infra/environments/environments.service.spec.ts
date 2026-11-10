import { ConflictException, NotFoundException } from "@nestjs/common";
import { EnvironmentsService } from "./environments.service";

describe("EnvironmentsService", () => {
  const prisma = { infraEnvironment: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() } };
  const service = new EnvironmentsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it("lists environments with their device counts", async () => {
    prisma.infraEnvironment.findMany.mockResolvedValue([
      { id: "e1", name: "Home", slug: "home", description: null, createdAt: new Date(), _count: { devices: 3 } },
    ]);

    const result = await service.list();

    expect(result).toEqual([
      { id: "e1", name: "Home", slug: "home", description: null, deviceCount: 3, createdAt: expect.any(Date) },
    ]);
  });

  it("throws NotFoundException for a missing environment", async () => {
    prisma.infraEnvironment.findUnique.mockResolvedValue(null);

    await expect(service.get("missing")).rejects.toThrow(NotFoundException);
  });

  it("refuses to create an environment with a duplicate slug", async () => {
    prisma.infraEnvironment.findUnique.mockResolvedValue({ id: "e1", slug: "home" });

    await expect(service.create({ name: "Home 2", slug: "home" })).rejects.toThrow(ConflictException);
    expect(prisma.infraEnvironment.create).not.toHaveBeenCalled();
  });

  it("creates a new environment when the slug is free", async () => {
    prisma.infraEnvironment.findUnique.mockResolvedValue(null);
    prisma.infraEnvironment.create.mockResolvedValue({ id: "e1", name: "Home", slug: "home" });

    const result = await service.create({ name: "Home", slug: "home" });

    expect(result).toEqual({ id: "e1", name: "Home", slug: "home" });
  });
});
