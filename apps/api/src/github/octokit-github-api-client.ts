import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import {
  GithubApiClient,
  GithubCommit,
  GithubContributor,
  GithubPullRequest,
  GithubRepository,
} from "./github-api-client";

const RECENT_COMMITS_PER_PAGE = 20;
const RECENT_PULL_REQUESTS_PER_PAGE = 20;

/**
 * Talks to the real GitHub REST API, authenticated as a GitHub App
 * installation. Constructed only when GITHUB_APP_ID and
 * GITHUB_APP_PRIVATE_KEY are configured (see GithubModule) — this class has
 * not been exercised against the live GitHub API in this environment,
 * since no App registration exists here. Its request-shaping logic is
 * covered by unit tests that mock the underlying Octokit instance; that is
 * not the same as an end-to-end verification against GitHub itself.
 */
export class OctokitGithubApiClient implements GithubApiClient {
  // One Octokit instance (and installation access token) per installation,
  // reused across calls within a sync pass instead of re-authenticating
  // for every single request.
  private readonly clientsByInstallation = new Map<bigint, Octokit>();

  constructor(
    private readonly appId: string,
    private readonly privateKey: string,
  ) {}

  private clientFor(installationId: bigint): Octokit {
    const existing = this.clientsByInstallation.get(installationId);
    if (existing) return existing;

    const client = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: this.appId,
        privateKey: this.privateKey,
        installationId: Number(installationId),
      },
    });
    this.clientsByInstallation.set(installationId, client);
    return client;
  }

  async listInstallationRepositories(installationId: bigint): Promise<GithubRepository[]> {
    const octokit = this.clientFor(installationId);
    const repos = await octokit.paginate(octokit.apps.listReposAccessibleToInstallation, {
      per_page: 100,
    });

    return repos.map((repo) => ({
      githubId: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      isPrivate: repo.private,
      defaultBranch: repo.default_branch,
    }));
  }

  async listRepositoryContributors(
    installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<GithubContributor[]> {
    const octokit = this.clientFor(installationId);
    const contributors = await octokit.paginate(octokit.repos.listContributors, {
      owner,
      repo,
      per_page: 100,
    });

    return contributors
      .filter((c): c is typeof c & { login: string } => Boolean(c.login))
      .map((c) => ({ login: c.login, contributions: c.contributions ?? 0 }));
  }

  async listRecentCommits(
    installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<GithubCommit[]> {
    const octokit = this.clientFor(installationId);
    const { data } = await octokit.repos.listCommits({
      owner,
      repo,
      per_page: RECENT_COMMITS_PER_PAGE,
    });

    return data.map((commit) => ({
      sha: commit.sha,
      authorLogin: commit.author?.login ?? null,
      message: commit.commit.message,
      committedAt: commit.commit.author?.date ?? new Date().toISOString(),
    }));
  }

  async listPullRequests(
    installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<GithubPullRequest[]> {
    const octokit = this.clientFor(installationId);
    const { data } = await octokit.pulls.list({
      owner,
      repo,
      state: "all",
      per_page: RECENT_PULL_REQUESTS_PER_PAGE,
    });

    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state === "open" ? ("open" as const) : ("closed" as const),
      authorLogin: pr.user?.login ?? null,
      createdAt: pr.created_at,
      mergedAt: pr.merged_at,
    }));
  }
}
