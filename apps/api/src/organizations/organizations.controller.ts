import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentOrganizationId } from "../auth/current-organization-id.decorator";
import { OrgApiKeyGuard } from "../auth/org-api-key.guard";
import { OrganizationsService } from "./organizations.service";

@Controller("organizations/me")
@UseGuards(OrgApiKeyGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  getOrganization(@CurrentOrganizationId() organizationId: string) {
    return this.organizations.getOrganization(organizationId);
  }

  @Get("departments")
  listDepartments(@CurrentOrganizationId() organizationId: string) {
    return this.organizations.listDepartments(organizationId);
  }

  @Get("developers")
  listDevelopers(@CurrentOrganizationId() organizationId: string) {
    return this.organizations.listDevelopers(organizationId);
  }
}
