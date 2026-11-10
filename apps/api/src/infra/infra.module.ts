import { Module } from "@nestjs/common";
import { ActionsModule } from "./actions/actions.module";
import { AiModule } from "./ai/ai.module";
import { AuditModule } from "./audit/audit.module";
import { TraceAuthModule } from "./auth/trace-auth.module";
import { ConnectorsModule } from "./connectors/connectors.module";
import { ConsoleModule } from "./console/console.module";
import { CredentialsModule } from "./credentials/credentials.module";
import { InfraDevicesModule } from "./devices/devices.module";
import { DiscoveryModule } from "./discovery/discovery.module";
import { EnvironmentsModule } from "./environments/environments.module";
import { MonitoringModule } from "./monitoring/monitoring.module";
import { TopologyModule } from "./topology/topology.module";

/**
 * The infrastructure control plane — everything added on top of
 * TRACE's original developer-intelligence product (organizations,
 * devices, github, security, telemetry — all untouched, still mounted
 * separately in app.module.ts). See docs/ARCHITECTURE.md.
 */
@Module({
  imports: [
    TraceAuthModule,
    AuditModule,
    ConnectorsModule,
    CredentialsModule,
    EnvironmentsModule,
    InfraDevicesModule,
    DiscoveryModule,
    ConsoleModule,
    ActionsModule,
    MonitoringModule,
    TopologyModule,
    AiModule,
  ],
})
export class InfraModule {}
