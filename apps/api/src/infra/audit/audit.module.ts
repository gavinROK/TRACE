import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogService } from "./audit-log.service";

@Module({
  imports: [PrismaModule, TraceAuthModule],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
