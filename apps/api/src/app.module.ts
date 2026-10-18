import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { GithubModule } from "./github/github.module";
import { HealthModule } from "./health/health.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    OrganizationsModule,
    GithubModule,
  ],
})
export class AppModule {}
