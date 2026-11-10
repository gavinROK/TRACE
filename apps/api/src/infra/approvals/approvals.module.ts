import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { ApprovalsService } from "./approvals.service";

/**
 * A leaf module (depends only on Prisma + audit, nothing infra-domain-
 * specific) so it can be imported by `ConsoleModule`/`ActionsModule`
 * (to gate an MCP-actor's command/action calls) and by `AiModule` (for
 * the native assistant's own tool-call loop) without any circular
 * module dependency — neither Console nor Actions needs to import
 * AiModule, and AiModule already imports both of them.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
