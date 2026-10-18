import {
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentOrganizationId } from "../auth/current-organization-id.decorator";
import { OrgApiKeyGuard } from "../auth/org-api-key.guard";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectInstallationDto } from "./dto/connect-installation.dto";
import { GithubSyncService } from "./github-sync.service";

@Controller("github/installations")
@UseGuards(OrgApiKeyGuard)
export class GithubInstallationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly githubSync: GithubSyncService,
  ) {}

  /**
   * Records a GitHub App installation the caller's organization has
   * already completed on GitHub's side. This does not grant access to
   * anything — it only lets TRACE know which installation id belongs to
   * which organization, which is what the webhook handler and sync
   * service rely on to stay org-scoped.
   */
  @Post()
  async connect(
    @CurrentOrganizationId() organizationId: string,
    @Body() dto: ConnectInstallationDto,
  ) {
    const installationId = BigInt(dto.installationId);

    const existing = await this.prisma.githubInstallation.findUnique({
      where: { installationId },
    });
    if (existing && existing.organizationId !== organizationId) {
      throw new ConflictException(
        "This GitHub installation is already connected to a different organization",
      );
    }

    return this.prisma.githubInstallation.upsert({
      where: { installationId },
      create: {
        organizationId,
        installationId,
        accountLogin: dto.accountLogin,
        accountType: dto.accountType,
      },
      update: {
        accountLogin: dto.accountLogin,
        accountType: dto.accountType,
      },
    });
  }

  /**
   * Runs a sync now. There is no scheduler yet (see
   * docs/DEVELOPMENT_STATUS.md), so this is how a sync actually happens
   * today — manually, or eventually from a webhook event.
   */
  @Post(":id/sync")
  async sync(@CurrentOrganizationId() organizationId: string, @Param("id") id: string) {
    const installation = await this.prisma.githubInstallation.findFirst({
      where: { id, organizationId },
    });
    if (!installation) {
      throw new NotFoundException("GitHub installation not found");
    }

    return this.githubSync.syncInstallation({
      id: installation.id,
      organizationId: installation.organizationId,
      installationId: installation.installationId,
    });
  }
}
