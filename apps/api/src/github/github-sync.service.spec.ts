import { ActivityEventType } from "../activity/activity-event-type";
import { GithubApiClient, GithubCommit, GithubPullRequest, GithubRepository } from "./github-api-client";
import { GithubSyncService } from "./github-sync.service";

function repo(githubId: number, name: string): GithubRepository {
  return { githubId, name, fullName: `acme/${name}`, isPrivate: true, defaultBranch: "main" };
}

function commit(sha: string, authorLogin: string | null): GithubCommit {
  return { sha, authorLogin, message: "msg", committedAt: new Date().toISOString() };
}

function pr(number: number, authorLogin: string | null): GithubPullRequest {
  return {
    number,
    title: "title",
    state: "open",
    authorLogin,
    createdAt: new Date().toISOString(),
    mergedAt: null,
  };
}

describe("GithubSyncService", () => {
  const prisma = {
    repository: { upsert: jest.fn() },
    activityEvent: { upsert: jest.fn() },
    developer: { findFirst: jest.fn() },
  };

  const client: jest.Mocked<GithubApiClient> = {
    listInstallationRepositories: jest.fn(),
    listRepositoryContributors: jest.fn(),
    listRecentCommits: jest.fn(),
    listPullRequests: jest.fn(),
  };

  const service = new GithubSyncService(client, prisma as never);
  const installation = { id: "install_row_1", organizationId: "org_1", installationId: 999n };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.developer.findFirst.mockResolvedValue(null);
  });

  it("scopes the commit/PR dedupe key by repository, not just org+type+externalId", async () => {
    // Regression test: the same commit sha/PR number showing up in two
    // different repositories must NOT collide — a real bug this exact
    // scenario caught during live integration testing.
    client.listInstallationRepositories.mockResolvedValue([repo(1, "repo-a"), repo(2, "repo-b")]);
    client.listRecentCommits.mockResolvedValue([commit("same-sha", null)]);
    client.listPullRequests.mockResolvedValue([pr(1, null)]);
    prisma.repository.upsert
      .mockResolvedValueOnce({ id: "repo_row_a" })
      .mockResolvedValueOnce({ id: "repo_row_b" });

    await service.syncInstallation(installation);

    const commitUpsertCalls = prisma.activityEvent.upsert.mock.calls.filter(
      ([args]) => args.create.type === ActivityEventType.COMMIT,
    );
    expect(commitUpsertCalls).toHaveLength(2);
    expect(commitUpsertCalls[0][0].where.organizationId_repositoryId_type_externalId).toEqual({
      organizationId: "org_1",
      repositoryId: "repo_row_a",
      type: ActivityEventType.COMMIT,
      externalId: "same-sha",
    });
    expect(commitUpsertCalls[1][0].where.organizationId_repositoryId_type_externalId).toEqual({
      organizationId: "org_1",
      repositoryId: "repo_row_b",
      type: ActivityEventType.COMMIT,
      externalId: "same-sha",
    });
  });

  it("reports accurate repositoriesSynced/activityEventsSynced counts", async () => {
    client.listInstallationRepositories.mockResolvedValue([repo(1, "repo-a")]);
    client.listRecentCommits.mockResolvedValue([commit("sha1", null), commit("sha2", null)]);
    client.listPullRequests.mockResolvedValue([pr(1, null)]);
    prisma.repository.upsert.mockResolvedValue({ id: "repo_row_a" });

    const result = await service.syncInstallation(installation);

    expect(result).toEqual({ repositoriesSynced: 1, activityEventsSynced: 3 });
  });

  it("attributes a developer only on an exact githubLogin match within the organization", async () => {
    client.listInstallationRepositories.mockResolvedValue([repo(1, "repo-a")]);
    client.listRecentCommits.mockResolvedValue([commit("sha1", "alice-gh")]);
    client.listPullRequests.mockResolvedValue([]);
    prisma.repository.upsert.mockResolvedValue({ id: "repo_row_a" });
    prisma.developer.findFirst.mockResolvedValue({ id: "dev_alice" });

    await service.syncInstallation(installation);

    expect(prisma.developer.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org_1", githubLogin: "alice-gh" },
      select: { id: true },
    });
    expect(prisma.activityEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ developerId: "dev_alice" }) }),
    );
  });

  it("leaves developerId null when no commit author login is given", async () => {
    client.listInstallationRepositories.mockResolvedValue([repo(1, "repo-a")]);
    client.listRecentCommits.mockResolvedValue([commit("sha1", null)]);
    client.listPullRequests.mockResolvedValue([]);
    prisma.repository.upsert.mockResolvedValue({ id: "repo_row_a" });

    await service.syncInstallation(installation);

    expect(prisma.developer.findFirst).not.toHaveBeenCalled();
    expect(prisma.activityEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ developerId: null }) }),
    );
  });

  it("skips a repository whose fullName doesn't look like owner/repo", async () => {
    client.listInstallationRepositories.mockResolvedValue([
      { ...repo(1, "weird"), fullName: "no-slash-here" },
    ]);
    prisma.repository.upsert.mockResolvedValue({ id: "repo_row_weird" });

    const result = await service.syncInstallation(installation);

    expect(client.listRecentCommits).not.toHaveBeenCalled();
    expect(client.listPullRequests).not.toHaveBeenCalled();
    expect(result).toEqual({ repositoriesSynced: 1, activityEventsSynced: 0 });
  });
});
