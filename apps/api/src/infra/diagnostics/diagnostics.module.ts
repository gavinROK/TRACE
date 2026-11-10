import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { ConnectorsModule } from "../connectors/connectors.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { DiagnosticsController } from "./diagnostics.controller";
import { DiagnosticsService } from "./diagnostics.service";

@Module({
  imports: [PrismaModule, AuditModule, TraceAuthModule, ConnectorsModule, CredentialsModule],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
