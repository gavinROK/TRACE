import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuditLogService } from "../audit/audit-log.service";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { CreateEnvironmentDto } from "./dto/create-environment.dto";
import { EnvironmentsService } from "./environments.service";

@UseGuards(TraceAccessGuard)
@Controller("infra/environments")
export class EnvironmentsController {
  constructor(
    private readonly environmentsService: EnvironmentsService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  list() {
    return this.environmentsService.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.environmentsService.get(id);
  }

  @Post()
  async create(@Req() req: InfraAuthenticatedRequest, @Body() dto: CreateEnvironmentDto) {
    const environment = await this.environmentsService.create(dto);
    await this.auditLog.record({
      environmentId: environment.id,
      actor: req.actor,
      action: "environment.create",
      targetType: "InfraEnvironment",
      targetId: environment.id,
      outcome: "success",
      detail: { name: dto.name, slug: dto.slug },
    });
    return environment;
  }
}
