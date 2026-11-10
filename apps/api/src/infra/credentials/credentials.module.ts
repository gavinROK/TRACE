import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { CredentialEnrollmentController } from "./credential-enrollment.controller";
import { CredentialEnrollmentService } from "./credential-enrollment.service";
import { CredentialsController } from "./credentials.controller";
import { CredentialsService } from "./credentials.service";
import { MasterKeyStore } from "./master-key.store";

@Module({
  imports: [PrismaModule, AuditModule, TraceAuthModule, ApprovalsModule],
  controllers: [CredentialsController, CredentialEnrollmentController],
  providers: [CredentialsService, MasterKeyStore, CredentialEnrollmentService],
  exports: [CredentialsService, MasterKeyStore, CredentialEnrollmentService],
})
export class CredentialsModule {}
