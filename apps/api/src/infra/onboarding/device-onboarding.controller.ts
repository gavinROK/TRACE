import { Body, Controller, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AiActionClassification } from "@prisma/client";
import { ApprovalsService } from "../approvals/approvals.service";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { MCP_ACTOR, isMcpActor } from "../auth/mcp-actor";
import { DeviceOnboardingService } from "./device-onboarding.service";
import { ConfigureOnboardingDto } from "./dto/configure-onboarding.dto";

/**
 * TRACE v0.6: the MCP-facing half of device onboarding — see
 * device-onboarding.service.ts for the full two-phase design.
 * `configure` is gated for the MCP actor exactly like
 * `update_device`/`request_credential_enrollment` (one pending action,
 * bound to the exact ip/name/category this call was made with — a
 * human approving it never approves a different target than what's
 * shown). `verify` is never gated — it only ever records what a real
 * connector call actually observed, same precedent as
 * `check-health`/`diagnostics`.
 */
@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/onboarding")
export class DeviceOnboardingController {
  constructor(
    @Inject(DeviceOnboardingService) private readonly onboarding: DeviceOnboardingService,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  @Post("configure")
  async configure(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Body() dto: ConfigureOnboardingDto,
  ) {
    if (isMcpActor(req.actor)) {
      const pending = await this.approvals.create({
        environmentId,
        toolName: "onboard_device",
        toolInput: { ip: dto.ip, name: dto.name, category: dto.category },
        classification: AiActionClassification.ADMINISTRATIVE,
        requestedBy: MCP_ACTOR,
      });
      return {
        pending: true as const,
        pendingActionId: pending.id,
        classification: AiActionClassification.ADMINISTRATIVE,
        message:
          "This administrative action requires human approval in TRACE's dashboard (Settings → Pending approvals) before it will run — it will import/configure exactly this IP, name, and category, nothing else. It has NOT been executed.",
      };
    }
    return this.onboarding.configure(environmentId, req.actor, dto);
  }

  @Post(":deviceId/verify")
  verify(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("deviceId") deviceId: string,
  ) {
    return this.onboarding.verify(environmentId, deviceId, req.actor);
  }
}
