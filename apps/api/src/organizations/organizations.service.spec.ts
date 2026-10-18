import { NotFoundException } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";

describe("OrganizationsService", () => {
  const prisma = {
    organization: { findUnique: jest.fn() },
    department: { findMany: jest.fn() },
    developer: { findMany: jest.fn() },
  };
  const service = new OrganizationsService(prisma as never);

  beforeEach(() => {
    prisma.organization.findUnique.mockReset();
    prisma.department.findMany.mockReset();
    prisma.developer.findMany.mockReset();
  });

  it("returns the organization matching the given id", async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: "org_1", name: "Acme" });

    const result = await service.getOrganization("org_1");

    expect(result).toEqual({ id: "org_1", name: "Acme" });
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({ where: { id: "org_1" } });
  });

  it("throws NotFoundException when the organization doesn't exist", async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.getOrganization("org_missing")).rejects.toThrow(NotFoundException);
  });

  it("scopes listDepartments to the given organization only", async () => {
    prisma.department.findMany.mockResolvedValue([]);

    await service.listDepartments("org_1");

    expect(prisma.department.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      orderBy: { name: "asc" },
    });
  });

  it("scopes listDevelopers to the given organization only", async () => {
    prisma.developer.findMany.mockResolvedValue([]);

    await service.listDevelopers("org_2");

    expect(prisma.developer.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_2" },
      orderBy: { name: "asc" },
    });
  });
});
