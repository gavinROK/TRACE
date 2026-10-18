import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentOrganizationId } from "../auth/current-organization-id.decorator";
import { OrgApiKeyGuard } from "../auth/org-api-key.guard";
import { GraphService } from "./graph.service";

@Controller("graph")
@UseGuards(OrgApiKeyGuard)
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Get("snapshot")
  getSnapshot(@CurrentOrganizationId() organizationId: string) {
    return this.graph.getSnapshot(organizationId);
  }
}
