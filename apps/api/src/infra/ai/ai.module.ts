import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "../../prisma/prisma.module";
import { ActionsModule } from "../actions/actions.module";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { ConsoleModule } from "../console/console.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { InfraDevicesModule } from "../devices/devices.module";
import { DiscoveryModule } from "../discovery/discovery.module";
import { EnvironmentsModule } from "../environments/environments.module";
import { MonitoringModule } from "../monitoring/monitoring.module";
import { DeviceOnboardingModule } from "../onboarding/device-onboarding.module";
import { TopologyModule } from "../topology/topology.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { AiChatService } from "./ai-chat.service";
import { AiConversationsService } from "./ai-conversations.service";
import { AiSettingsService } from "./ai-settings.service";
import { AiToolsRegistryService } from "./ai-tools.registry";
import { AiController } from "./ai.controller";
import { AnthropicProviderService } from "./providers/anthropic-provider.service";

/**
 * The native AI assistant (TRACE v0.3). A consumer of the infra control
 * plane's existing services, not a second implementation of it —
 * imports the modules that already own device/topology/console/action/
 * discovery/credential logic instead of reaching into their internals,
 * same pattern infra.module.ts itself uses for every other module here.
 *
 * `AnthropicProviderService` is the only provider implemented today
 * (PRODUCT_SPEC v0.3 section 9) — adding OpenAI/local-model support
 * later means adding a new provider service and a branch in
 * ai-settings.service.ts's provider switch, never touching
 * ai-chat.service.ts or ai-tools.registry.ts, which only know the
 * provider-agnostic AiProvider interface.
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
    TraceAuthModule,
    CredentialsModule,
    EnvironmentsModule,
    InfraDevicesModule,
    MonitoringModule,
    TopologyModule,
    ConsoleModule,
    ActionsModule,
    DiscoveryModule,
    ApprovalsModule,
    DeviceOnboardingModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  controllers: [AiController],
  providers: [AiSettingsService, AnthropicProviderService, AiToolsRegistryService, AiConversationsService, AiChatService],
})
export class AiModule {}
