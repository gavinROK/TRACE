import { Module } from "@nestjs/common";
import { OrgApiKeyGuard } from "./org-api-key.guard";

@Module({
  providers: [OrgApiKeyGuard],
  exports: [OrgApiKeyGuard],
})
export class AuthModule {}
