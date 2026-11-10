import { Body, Controller, ForbiddenException, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AiActionClassification } from "@prisma/client";
import { ApprovalsService } from "../approvals/approvals.service";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { MCP_ACTOR, isMcpActor } from "../auth/mcp-actor";
import { CredentialEnrollmentService } from "./credential-enrollment.service";
import { CompleteCredentialEnrollmentDto } from "./dto/complete-credential-enrollment.dto";
import { RequestCredentialEnrollmentDto } from "./dto/request-credential-enrollment.dto";

/**
 * The MCP-facing half of TRACE v0.5's temporary credential-enrollment
 * workflow — see credential-enrollment.service.ts for the full flow.
 * This controller only ever moves metadata (protocol, label, session
 * status); the three routes that can affect a real credential
 * (`complete`, and transitively `cancel`) are refused outright for the
 * MCP actor, same `isMcpActor` check every other write-capable infra
 * controller already uses.
 */
@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId")
export class CredentialEnrollmentController {
  constructor(
    @Inject(CredentialEnrollmentService) private readonly enrollment: CredentialEnrollmentService,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  /**
   * Only an external MCP client ever proposes an enrollment this way —
   * a real browser session already has the manual "+ Add credential"
   * form directly on the device panel and has no reason to go through
   * an approval round-trip with itself. Never creates a
   * CredentialEnrollmentSession row itself: like `update_device`, this
   * only creates the AiPendingAction; the session (and its 5-minute
   * clock) is created by `AiToolsRegistryService`'s handler, which
   * only runs once a human approves it (see
   * credential-enrollment.service.ts `authorizeSession`).
   */
  @Post("devices/:deviceId/credential-enrollment-sessions")
  async propose(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("deviceId") deviceId: string,
    @Body() dto: RequestCredentialEnrollmentDto,
  ) {
    if (!isMcpActor(req.actor)) {
      throw new ForbiddenException(
        "Request enrollment through TRACE MCP (Claude) — a browser session can add a credential directly from the device panel.",
      );
    }
    if (!this.enrollment.isEnabled()) {
      throw new ForbiddenException(
        "Temporary credential enrollment is disabled. An operator must set TRACE_CREDENTIAL_ENROLLMENT_ENABLED=true to allow it.",
      );
    }

    const pending = await this.approvals.create({
      environmentId,
      toolName: "request_credential_enrollment",
      toolInput: { deviceId, protocol: dto.protocol, label: dto.label },
      classification: AiActionClassification.ADMINISTRATIVE,
      requestedBy: MCP_ACTOR,
    });

    return {
      pending: true as const,
      pendingActionId: pending.id,
      classification: AiActionClassification.ADMINISTRATIVE,
      message:
        "This administrative action requires human approval in TRACE's dashboard (Settings → Pending approvals). Approving it opens a 5-minute window during which the credential can be typed directly into TRACE's device panel — never into Claude. It has NOT been executed.",
    };
  }

  /** Read-only status for the device's current (or most recent)
   * enrollment session. Deliberately not actor-gated — never includes
   * a secret, so both the dashboard (for its own banner) and an
   * external MCP client (to know when a human has finished) may call
   * this freely, same as trace_get_pending_action_status. */
  @Get("devices/:deviceId/credential-enrollment-sessions/active")
  getActive(@Param("environmentId") environmentId: string, @Param("deviceId") deviceId: string) {
    return this.enrollment.getActive(environmentId, deviceId);
  }

  /** The only route that can turn a session into a real credential —
   * refused outright for the MCP actor, so the secret this body
   * carries can only ever arrive from a real browser session typing it
   * into TRACE's own UI. */
  @Post("credential-enrollment-sessions/:sessionId/complete")
  async complete(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("sessionId") sessionId: string,
    @Body() dto: CompleteCredentialEnrollmentDto,
  ) {
    if (isMcpActor(req.actor)) {
      throw new ForbiddenException("Only a browser session can supply a credential value.");
    }
    return this.enrollment.complete(environmentId, sessionId, req.actor, dto);
  }

  @Post("credential-enrollment-sessions/:sessionId/cancel")
  async cancel(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("sessionId") sessionId: string,
  ) {
    if (isMcpActor(req.actor)) {
      throw new ForbiddenException("Only a browser session can cancel an enrollment session.");
    }
    await this.enrollment.cancel(environmentId, sessionId, req.actor);
    return { ok: true };
  }
}
