import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuditLogService } from "../audit/audit-log.service";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { CredentialsService } from "./credentials.service";
import { CreateCredentialDto } from "./dto/create-credential.dto";

/**
 * Every response here is credential *metadata* only (id, label, protocol,
 * timestamps) — never a decrypted payload. See credentials.service.ts.
 */
@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/credentials")
export class CredentialsController {
  constructor(
    @Inject(CredentialsService) private readonly credentialsService: CredentialsService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  list(@Param("environmentId") environmentId: string) {
    return this.credentialsService.listForEnvironment(environmentId);
  }

  @Post()
  async create(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Body() dto: CreateCredentialDto,
  ) {
    const created = await this.credentialsService.create(environmentId, dto);
    await this.auditLog.record({
      environmentId,
      actor: req.actor,
      action: "credential.create",
      targetType: "InfraCredential",
      targetId: created.id,
      outcome: "success",
      detail: { label: dto.label, protocol: dto.protocol, deviceId: dto.deviceId },
    });
    return created;
  }

  @Delete(":credentialId")
  async remove(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("credentialId") credentialId: string,
  ) {
    await this.credentialsService.remove(environmentId, credentialId);
    await this.auditLog.record({
      environmentId,
      actor: req.actor,
      action: "credential.delete",
      targetType: "InfraCredential",
      targetId: credentialId,
      outcome: "success",
    });
    return { ok: true };
  }
}
