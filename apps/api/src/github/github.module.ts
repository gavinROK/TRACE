import { Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { GITHUB_API_CLIENT } from "./github-api-client";
import { GithubInstallationsController } from "./github-installations.controller";
import { GithubSyncService } from "./github-sync.service";
import { GithubWebhookController } from "./github-webhook.controller";
import { MockGithubApiClient } from "./mock-github-api-client";
import { OctokitGithubApiClient } from "./octokit-github-api-client";

const logger = new Logger("GithubModule");

@Module({
  imports: [AuthModule],
  controllers: [GithubInstallationsController, GithubWebhookController],
  providers: [
    GithubSyncService,
    MockGithubApiClient,
    {
      provide: GITHUB_API_CLIENT,
      useFactory: (config: ConfigService, mock: MockGithubApiClient) => {
        const appId = config.get<string>("GITHUB_APP_ID");
        const privateKey = config.get<string>("GITHUB_APP_PRIVATE_KEY");

        if (appId && privateKey) {
          logger.log("GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY configured — using the real GitHub API.");
          return new OctokitGithubApiClient(appId, privateKey);
        }

        logger.warn(
          "No GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY configured — GitHub sync will use mock data.",
        );
        return mock;
      },
      inject: [ConfigService, MockGithubApiClient],
    },
  ],
  exports: [GithubSyncService],
})
export class GithubModule {}
