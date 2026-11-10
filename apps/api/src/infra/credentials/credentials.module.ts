import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { CredentialsController } from "./credentials.controller";
import { CredentialsService } from "./credentials.service";
import { MasterKeyStore } from "./master-key.store";

@Module({
  imports: [PrismaModule, AuditModule, TraceAuthModule],
  controllers: [CredentialsController],
  providers: [CredentialsService, MasterKeyStore],
  exports: [CredentialsService, MasterKeyStore],
})
export class CredentialsModule {}
