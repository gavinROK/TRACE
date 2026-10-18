import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every method here takes the organizationId resolved by OrgApiKeyGuard
   * from the caller's own key — never an id supplied by the request body,
   * query string, or route params — so there is no way to ask for another
   * organization's data.
   */
  async getOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException("Organization not found");
    }

    return organization;
  }

  listDepartments(organizationId: string) {
    return this.prisma.department.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
  }

  listDevelopers(organizationId: string) {
    return this.prisma.developer.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
  }
}
