import {
  Controller,
  Headers,
  Logger,
  Post,
  Req,
  RawBodyRequest,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { verifyGithubWebhookSignature } from "./verify-github-webhook-signature";

interface GithubInstallationWebhookPayload {
  action: string;
  installation: { id: number };
}

/**
 * Every request is rejected unless its signature verifies against
 * GITHUB_WEBHOOK_SECRET — see verify-github-webhook-signature.ts. Only a
 * narrow set of event types is actually processed today (see the switch
 * below); everything else is acknowledged but not yet acted on, which is
 * tracked in docs/DEVELOPMENT_STATUS.md rather than silently pretended to
 * be handled.
 */
@Controller("webhooks/github")
export class GithubWebhookController {
  private readonly logger = new Logger(GithubWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Headers("x-github-event") event: string | undefined,
  ) {
    const secret = this.config.get<string>("GITHUB_WEBHOOK_SECRET");
    if (!secret) {
      throw new ServiceUnavailableException("GitHub webhooks are not configured");
    }

    const rawBody = request.rawBody;
    if (!rawBody || !verifyGithubWebhookSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const payload = JSON.parse(rawBody.toString("utf8"));

    switch (event) {
      case "ping":
        return { ok: true };
      case "installation":
        await this.handleInstallationEvent(payload as GithubInstallationWebhookPayload);
        return { received: true, processed: true };
      default:
        this.logger.debug(`Received unhandled GitHub event type: ${event ?? "(none)"}`);
        return { received: true, processed: false };
    }
  }

  private async handleInstallationEvent(
    payload: GithubInstallationWebhookPayload,
  ): Promise<void> {
    if (payload.action !== "deleted") {
      // Creation/permission-change actions are handled by the explicit
      // POST /github/installations connect endpoint instead, since only
      // that request is authenticated as a specific TRACE organization.
      return;
    }

    await this.prisma.githubInstallation.deleteMany({
      where: { installationId: BigInt(payload.installation.id) },
    });
  }
}
