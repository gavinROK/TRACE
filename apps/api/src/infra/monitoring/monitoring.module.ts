import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { ConnectorsModule } from "../connectors/connectors.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { DevicePollingService } from "./device-polling.service";
import { MetricsController } from "./metrics.controller";
import { MetricsSchedulerService } from "./metrics-scheduler.service";

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, AuditModule, ConnectorsModule, CredentialsModule, TraceAuthModule],
  controllers: [MetricsController],
  providers: [DevicePollingService, MetricsSchedulerService],
  exports: [DevicePollingService],
})
export class MonitoringModule {}
