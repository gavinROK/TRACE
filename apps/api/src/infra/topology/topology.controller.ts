import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { TraceAccessGuard } from "../auth/trace-access.guard";
import { TopologyService } from "./topology.service";

@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/topology")
export class TopologyController {
  constructor(private readonly topologyService: TopologyService) {}

  @Get()
  get(@Param("environmentId") environmentId: string) {
    return this.topologyService.getSnapshot(environmentId);
  }
}
