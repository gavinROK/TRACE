import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { TraceAccessGuard } from "../auth/trace-access.guard";
import { AuditLogService } from "./audit-log.service";

@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/audit-log")
export class AuditLogController {
  constructor(@Inject(AuditLogService) private readonly auditLog: AuditLogService) {}

  @Get()
  list(@Param("environmentId") environmentId: string, @Query("limit") limit?: string) {
    return this.auditLog.listForEnvironment(environmentId, limit ? Number(limit) : undefined);
  }
}
