export interface GithubRepository {
  githubId: number;
  name: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
}

export interface GithubCommit {
  sha: string;
  authorLogin: string | null;
  message: string;
  committedAt: string;
}

export interface GithubPullRequest {
  number: number;
  title: string;
  state: "open" | "closed";
  authorLogin: string | null;
  createdAt: string;
  mergedAt: string | null;
}

export interface GithubContributor {
  login: string;
  contributions: number;
}

/**
 * Everything TRACE needs to read from GitHub for one installation. Two
 * implementations exist: OctokitGithubApiClient (real, talks to the GitHub
 * REST API) and MockGithubApiClient (deterministic sample data for local
 * development without a registered GitHub App). GithubSyncService depends
 * only on this interface, so the same sync logic runs — and is tested —
 * against either one.
 *
 * Every method takes `installationId` because that's what GitHub App
 * authentication actually requires to mint an installation access token —
 * it cannot be re-derived from an owner/repo pair alone.
 */
export interface GithubApiClient {
  listInstallationRepositories(installationId: bigint): Promise<GithubRepository[]>;
  listRepositoryContributors(
    installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<GithubContributor[]>;
  listRecentCommits(
    installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<GithubCommit[]>;
  listPullRequests(
    installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<GithubPullRequest[]>;
}

export const GITHUB_API_CLIENT = Symbol("GITHUB_API_CLIENT");
