import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { GithubModule } from "./github/github.module";
import { GraphModule } from "./graph/graph.module";
import { HealthModule } from "./health/health.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SecurityModule } from "./security/security.module";
import { TelemetryModule } from "./telemetry/telemetry.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    OrganizationsModule,
    GithubModule,
    TelemetryModule,
    SecurityModule,
    GraphModule,
  ],
})
export class AppModule {}
