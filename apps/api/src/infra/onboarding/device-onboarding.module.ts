import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { ConnectorsModule } from "../connectors/connectors.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { InfraDevicesModule } from "../devices/devices.module";
import { DiscoveryModule } from "../discovery/discovery.module";
import { MonitoringModule } from "../monitoring/monitoring.module";
import { DeviceOnboardingController } from "./device-onboarding.controller";
import { DeviceOnboardingService } from "./device-onboarding.service";

@Module({
  imports: [AuditModule, TraceAuthModule, ApprovalsModule, ConnectorsModule, CredentialsModule, InfraDevicesModule, DiscoveryModule, MonitoringModule],
  controllers: [DeviceOnboardingController],
  providers: [DeviceOnboardingService],
  exports: [DeviceOnboardingService],
})
export class DeviceOnboardingModule {}
