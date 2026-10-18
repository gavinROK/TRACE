import { Injectable, Logger } from "@nestjs/common";
import {
  GithubApiClient,
  GithubCommit,
  GithubContributor,
  GithubPullRequest,
  GithubRepository,
} from "./github-api-client";

/**
 * Clearly-labeled synthetic data, used whenever no real GitHub App
 * credentials are configured (see GithubModule). This exists so local
 * development and demos work without a GitHub App registration — it must
 * never be mistaken for a live integration. Every record it returns is
 * deterministic and tagged "mock-" so that's obvious downstream too.
 */
@Injectable()
export class MockGithubApiClient implements GithubApiClient {
  private readonly logger = new Logger(MockGithubApiClient.name);

  async listInstallationRepositories(installationId: bigint): Promise<GithubRepository[]> {
    this.logger.warn(
      `Using MOCK GitHub data for installation ${installationId} — no GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY configured.`,
    );
    return [
      {
        githubId: 1001,
        name: "mock-web-app",
        fullName: "mock-org/mock-web-app",
        isPrivate: true,
        defaultBranch: "main",
      },
      {
        githubId: 1002,
        name: "mock-api-service",
        fullName: "mock-org/mock-api-service",
        isPrivate: true,
        defaultBranch: "main",
      },
    ];
  }

  async listRepositoryContributors(
    _installationId: bigint,
    _owner: string,
    _repo: string,
  ): Promise<GithubContributor[]> {
    return [
      { login: "mock-dev-ada", contributions: 42 },
      { login: "mock-dev-priya", contributions: 27 },
    ];
  }

  async listRecentCommits(
    _installationId: bigint,
    _owner: string,
    _repo: string,
  ): Promise<GithubCommit[]> {
    const now = Date.now();
    return [
      {
        sha: "mock0000000000000000000000000000000000001",
        authorLogin: "mock-dev-ada",
        message: "Mock commit for local development",
        committedAt: new Date(now - 60 * 60 * 1000).toISOString(),
      },
      {
        sha: "mock0000000000000000000000000000000000002",
        authorLogin: "mock-dev-priya",
        message: "Another mock commit",
        committedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      },
    ];
  }

  async listPullRequests(
    _installationId: bigint,
    _owner: string,
    _repo: string,
  ): Promise<GithubPullRequest[]> {
    return [
      {
        number: 1,
        title: "Mock pull request",
        state: "open",
        authorLogin: "mock-dev-ada",
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        mergedAt: null,
      },
    ];
  }
}
