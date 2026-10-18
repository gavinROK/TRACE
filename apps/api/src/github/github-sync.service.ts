import { Inject, Injectable, Logger } from "@nestjs/common";
import { ActivityEventType } from "../activity/activity-event-type";
import { PrismaService } from "../prisma/prisma.service";
import { GITHUB_API_CLIENT, GithubApiClient } from "./github-api-client";

export interface InstallationRef {
  /** Repository.installationId — our own row id, not GitHub's installation id. */
  id: string;
  organizationId: string;
  installationId: bigint;
}

export interface SyncResult {
  repositoriesSynced: number;
  activityEventsSynced: number;
}

@Injectable()
export class GithubSyncService {
  private readonly logger = new Logger(GithubSyncService.name);

  constructor(
    @Inject(GITHUB_API_CLIENT) private readonly githubClient: GithubApiClient,
    private readonly prisma: PrismaService,
  ) {}

  async syncInstallation(installation: InstallationRef): Promise<SyncResult> {
    const repos = await this.githubClient.listInstallationRepositories(
      installation.installationId,
    );

    let activityEventsSynced = 0;

    for (const repo of repos) {
      const repositoryRow = await this.prisma.repository.upsert({
        where: { githubId: repo.githubId },
        create: {
          githubId: repo.githubId,
          name: repo.name,
          fullName: repo.fullName,
          isPrivate: repo.isPrivate,
          defaultBranch: repo.defaultBranch,
          organizationId: installation.organizationId,
          installationId: installation.id,
        },
        update: {
          name: repo.name,
          fullName: repo.fullName,
          isPrivate: repo.isPrivate,
          defaultBranch: repo.defaultBranch,
        },
      });

      const [owner, repoName] = repo.fullName.split("/");
      if (!owner || !repoName) {
        this.logger.warn(`Skipping repo with unexpected fullName shape: "${repo.fullName}"`);
        continue;
      }

      activityEventsSynced += await this.syncCommits(
        installation,
        repositoryRow.id,
        owner,
        repoName,
      );
      activityEventsSynced += await this.syncPullRequests(
        installation,
        repositoryRow.id,
        owner,
        repoName,
      );
    }

    return { repositoriesSynced: repos.length, activityEventsSynced };
  }

  private async syncCommits(
    installation: InstallationRef,
    repositoryId: string,
    owner: string,
    repo: string,
  ): Promise<number> {
    const commits = await this.githubClient.listRecentCommits(
      installation.installationId,
      owner,
      repo,
    );

    let synced = 0;
    for (const commit of commits) {
      const developerId = await this.resolveDeveloperId(
        installation.organizationId,
        commit.authorLogin,
      );

      await this.prisma.activityEvent.upsert({
        where: {
          organizationId_type_externalId: {
            organizationId: installation.organizationId,
            type: ActivityEventType.COMMIT,
            externalId: commit.sha,
          },
        },
        create: {
          organizationId: installation.organizationId,
          repositoryId,
          developerId,
          type: ActivityEventType.COMMIT,
          externalId: commit.sha,
          occurredAt: new Date(commit.committedAt),
          metadata: { message: commit.message, authorLogin: commit.authorLogin },
        },
        update: {
          developerId,
          metadata: { message: commit.message, authorLogin: commit.authorLogin },
        },
      });
      synced += 1;
    }
    return synced;
  }

  private async syncPullRequests(
    installation: InstallationRef,
    repositoryId: string,
    owner: string,
    repo: string,
  ): Promise<number> {
    const pullRequests = await this.githubClient.listPullRequests(
      installation.installationId,
      owner,
      repo,
    );

    let synced = 0;
    for (const pr of pullRequests) {
      const developerId = await this.resolveDeveloperId(
        installation.organizationId,
        pr.authorLogin,
      );

      await this.prisma.activityEvent.upsert({
        where: {
          organizationId_type_externalId: {
            organizationId: installation.organizationId,
            type: ActivityEventType.PULL_REQUEST,
            externalId: String(pr.number),
          },
        },
        create: {
          organizationId: installation.organizationId,
          repositoryId,
          developerId,
          type: ActivityEventType.PULL_REQUEST,
          externalId: String(pr.number),
          occurredAt: new Date(pr.createdAt),
          metadata: { title: pr.title, state: pr.state, authorLogin: pr.authorLogin },
        },
        update: {
          developerId,
          metadata: { title: pr.title, state: pr.state, authorLogin: pr.authorLogin },
        },
      });
      synced += 1;
    }
    return synced;
  }

  /**
   * Attribution is exact-match only (githubLogin equality) and never
   * guessed from a name or email — an unmatched login stays attributed to
   * no one rather than being guessed at.
   */
  private async resolveDeveloperId(
    organizationId: string,
    githubLogin: string | null,
  ): Promise<string | null> {
    if (!githubLogin) return null;

    const developer = await this.prisma.developer.findFirst({
      where: { organizationId, githubLogin },
      select: { id: true },
    });
    return developer?.id ?? null;
  }
}
