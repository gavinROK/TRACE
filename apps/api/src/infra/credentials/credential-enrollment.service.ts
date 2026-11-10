import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CredentialEnrollmentSession, CredentialEnrollmentStatus, InfraManagementProtocol } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { CredentialsService } from "./credentials.service";

export const CREDENTIAL_ENROLLMENT_WINDOW_MS = 5 * 60 * 1000;

export interface CredentialEnrollmentSessionStatus {
  id: string;
  environmentId: string;
  deviceId: string;
  protocol: InfraManagementProtocol;
  label: string | null;
  status: CredentialEnrollmentStatus;
  requestedBy: string;
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  credentialId: string | null;
  secondsRemaining: number;
}

/**
 * Owns `CredentialEnrollmentSession` — the temporary, single-use bridge
 * that lets an external MCP client (Claude) request a credential be
 * enrolled without ever receiving or transmitting the secret itself.
 *
 * The flow, end to end:
 *  1. Claude calls the MCP tool, which hits
 *     `CredentialEnrollmentController.propose` — that creates an
 *     `AiPendingAction` (classification ADMINISTRATIVE) exactly like
 *     `update_device`/`execute_command` do. No session row exists yet,
 *     and the feature is refused outright unless
 *     `TRACE_CREDENTIAL_ENROLLMENT_ENABLED=true` (requirement: disabled
 *     by default).
 *  2. A human approves that pending action from TRACE's own dashboard
 *     — the same approval endpoint, the same structural guarantee that
 *     no AI surface can approve its own action (see
 *     approvals/approvals.service.ts). That approval is what calls
 *     `authorizeSession` below, which is the only place a
 *     `CredentialEnrollmentSession` row is ever created, and the only
 *     place its 5-minute clock starts.
 *  3. The human types the credential directly into TRACE's dashboard
 *     (never into Claude, never through MCP) — the browser calls
 *     `complete`, which is the only method that can ever turn this
 *     session into a real `InfraCredential`, via the exact same
 *     `CredentialsService.create` (and therefore the exact same
 *     AES-256-GCM/MasterKeyStore encryption) the manual "+ Add
 *     credential" form already uses. No new cipher, no new key store.
 *  4. Expiration, cancellation, and successful completion are all
 *     terminal: `requireUsable` is the single choke point every
 *     mutation goes through, so a session can only ever be consumed
 *     once (replay prevention).
 */
@Injectable()
export class CredentialEnrollmentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
    @Inject(CredentialsService) private readonly credentialsService: CredentialsService,
  ) {}

  /** Disabled unless an operator has explicitly opted in — mirrors the
   * `TRACE_MCP_READ_ONLY` pattern in trace-access.guard.ts: read once
   * per call (never cached), so toggling the env var takes effect on
   * the next request without a restart in dev. */
  isEnabled(): boolean {
    return process.env.TRACE_CREDENTIAL_ENROLLMENT_ENABLED === "true";
  }

  /** Called only from `AiToolsRegistryService`'s `request_credential_enrollment`
   * handler, which itself only runs once a human has approved the
   * proposing pending action — `authorizedBy` is that approver's own
   * browser-session actor string, never the MCP actor (see
   * ApprovalsService.decide's refusal of a claude-mcp decider). */
  async authorizeSession(
    environmentId: string,
    deviceId: string,
    protocol: InfraManagementProtocol,
    label: string | undefined,
    authorizedBy: string,
  ): Promise<CredentialEnrollmentSessionStatus> {
    // Defense in depth: the proposing controller already checked this
    // flag before creating the pending action, but the flag could have
    // been turned off in the time it took a human to approve it.
    if (!this.isEnabled()) {
      throw new ForbiddenException(
        "Temporary credential enrollment is disabled. Set TRACE_CREDENTIAL_ENROLLMENT_ENABLED=true in apps/api/.env to allow it.",
      );
    }

    const device = await this.prisma.infraDevice.findFirst({ where: { id: deviceId, environmentId }, select: { id: true } });
    if (!device) {
      throw new BadRequestException("deviceId must belong to the same environment");
    }

    // At most one live window per device — opening a new one supersedes
    // (never silently coexists with) an older still-AUTHORIZED one, so
    // there is never ambiguity about which window a submitted
    // credential is completing.
    await this.prisma.credentialEnrollmentSession.updateMany({
      where: { deviceId, status: CredentialEnrollmentStatus.AUTHORIZED },
      data: { status: CredentialEnrollmentStatus.REVOKED },
    });

    const session = await this.prisma.credentialEnrollmentSession.create({
      data: {
        environmentId,
        deviceId,
        protocol,
        label,
        requestedBy: authorizedBy,
        expiresAt: new Date(Date.now() + CREDENTIAL_ENROLLMENT_WINDOW_MS),
      },
    });

    await this.auditLog.record({
      environmentId,
      actor: authorizedBy,
      action: "credential-enrollment.authorized",
      targetType: "CredentialEnrollmentSession",
      targetId: session.id,
      outcome: "success",
      detail: { deviceId, protocol, label, expiresAt: session.expiresAt.toISOString() },
    });

    return this.toStatus(session);
  }

  /** Read-only status for the device's most recent session (or null) —
   * never includes a secret, because this model never stores one. Safe
   * to call freely from either actor (browser dashboard polling for its
   * own banner, or Claude polling to know when a human has finished). */
  async getActive(environmentId: string, deviceId: string): Promise<CredentialEnrollmentSessionStatus | null> {
    const session = await this.prisma.credentialEnrollmentSession.findFirst({
      where: { environmentId, deviceId },
      orderBy: { createdAt: "desc" },
    });
    if (!session) return null;
    return this.toStatus(session);
  }

  /** The only way a session ever becomes a real credential. Browser-
   * actor only in practice — nothing in CredentialEnrollmentController
   * reaches this for the MCP actor (see its `complete` handler). */
  async complete(
    environmentId: string,
    sessionId: string,
    actor: string,
    dto: { label: string; payload: Record<string, unknown> },
  ) {
    const session = await this.requireUsable(environmentId, sessionId);

    const credential = await this.credentialsService.create(environmentId, {
      label: dto.label,
      protocol: session.protocol,
      deviceId: session.deviceId,
      payload: dto.payload,
    });

    await this.prisma.credentialEnrollmentSession.update({
      where: { id: session.id },
      data: { status: CredentialEnrollmentStatus.COMPLETED, completedAt: new Date(), credentialId: credential.id },
    });

    await this.auditLog.record({
      environmentId,
      actor,
      action: "credential-enrollment.completed",
      targetType: "CredentialEnrollmentSession",
      targetId: session.id,
      outcome: "success",
      detail: { deviceId: session.deviceId, protocol: session.protocol, credentialId: credential.id },
    });

    return credential;
  }

  /** Lets the human close the window early (requirement: cancel/revoke
   * at any time) — browser-actor only, same as `complete`. */
  async cancel(environmentId: string, sessionId: string, actor: string): Promise<void> {
    const session = await this.getById(environmentId, sessionId);
    if (session.status !== CredentialEnrollmentStatus.AUTHORIZED) {
      throw new BadRequestException(`This enrollment session is already ${session.status.toLowerCase()}`);
    }

    await this.prisma.credentialEnrollmentSession.update({
      where: { id: session.id },
      data: { status: CredentialEnrollmentStatus.REVOKED },
    });

    await this.auditLog.record({
      environmentId,
      actor,
      action: "credential-enrollment.cancelled",
      targetType: "CredentialEnrollmentSession",
      targetId: session.id,
      outcome: "success",
      detail: { deviceId: session.deviceId },
    });
  }

  /** The single choke point for "is this session still good to
   * consume" — called only from `complete`, so expiry is enforced at
   * the moment that matters (not just cosmetically on a read) and a
   * session already COMPLETED/EXPIRED/REVOKED can never be reused
   * (replay prevention). */
  private async requireUsable(environmentId: string, sessionId: string): Promise<CredentialEnrollmentSession> {
    const session = await this.getById(environmentId, sessionId);

    if (session.status !== CredentialEnrollmentStatus.AUTHORIZED) {
      throw new BadRequestException(`This enrollment session is ${session.status.toLowerCase()}, not awaiting a credential`);
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.credentialEnrollmentSession.update({
        where: { id: session.id },
        data: { status: CredentialEnrollmentStatus.EXPIRED },
      });
      throw new BadRequestException("This enrollment session expired — ask Claude to request a new one.");
    }

    return session;
  }

  private async getById(environmentId: string, sessionId: string): Promise<CredentialEnrollmentSession> {
    const session = await this.prisma.credentialEnrollmentSession.findFirst({ where: { id: sessionId, environmentId } });
    if (!session) throw new NotFoundException("Enrollment session not found");
    return session;
  }

  private toStatus(session: CredentialEnrollmentSession): CredentialEnrollmentSessionStatus {
    const expired = session.status === CredentialEnrollmentStatus.AUTHORIZED && session.expiresAt.getTime() <= Date.now();
    const status = expired ? CredentialEnrollmentStatus.EXPIRED : session.status;
    return {
      id: session.id,
      environmentId: session.environmentId,
      deviceId: session.deviceId,
      protocol: session.protocol,
      label: session.label,
      status,
      requestedBy: session.requestedBy,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      completedAt: session.completedAt,
      credentialId: session.credentialId,
      secondsRemaining: status === CredentialEnrollmentStatus.AUTHORIZED
        ? Math.max(0, Math.round((session.expiresAt.getTime() - Date.now()) / 1000))
        : 0,
    };
  }
}
