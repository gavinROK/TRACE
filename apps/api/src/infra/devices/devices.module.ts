import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { ConnectorsModule } from "../connectors/connectors.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { MonitoringModule } from "../monitoring/monitoring.module";
import { InfraDevicesController } from "./devices.controller";
import { InfraDevicesService } from "./devices.service";

@Module({
  imports: [PrismaModule, AuditModule, TraceAuthModule, ConnectorsModule, CredentialsModule, MonitoringModule, ApprovalsModule],
  controllers: [InfraDevicesController],
  providers: [InfraDevicesService],
  exports: [InfraDevicesService],
})
export class InfraDevicesModule {}
