import { Inject, Injectable } from "@nestjs/common";
import { InfraDeviceCategory, InfraManagementProtocol } from "@prisma/client";
import { AuditLogService } from "../audit/audit-log.service";
import { ConnectorRegistryService } from "../connectors/connector-registry.service";
import { CredentialsService } from "../credentials/credentials.service";
import { InfraDevicesService } from "../devices/devices.service";
import { DiscoveryScanService, PortProbeResult } from "../discovery/discovery-scan.service";
import { DevicePollingService } from "../monitoring/device-polling.service";
import { ConfigureOnboardingDto } from "./dto/configure-onboarding.dto";

export type OnboardingFailureCategory = "authentication" | "unreachable" | "host-key-mismatch" | "unknown";

/** Best-effort classification of a connector's free-text health-check
 * `detail` string (e.g. ssh2's raw error messages — see
 * ssh-connector.ts `getHealth`) — not a stable API contract connectors
 * are required to honor, just a heuristic so the onboarding report can
 * say "wrong password" instead of a bare unexplained OFFLINE. Always
 * returns a category rather than undefined/throwing, so a connector
 * whose wording doesn't match any pattern still gets an honest
 * "unknown" instead of silently missing from the report. */
export function classifyHealthFailure(detail: string | undefined): OnboardingFailureCategory {
  if (!detail) return "unknown";
  const text = detail.toLowerCase();
  if (text.includes("host key")) return "host-key-mismatch";
  if (text.includes("authentication") || text.includes("auth fail") || text.includes("permission denied")) return "authentication";
  if (text.includes("econnrefused") || text.includes("etimedout") || text.includes("unreachable") || text.includes("timed out") || text.includes("no route")) {
    return "unreachable";
  }
  return "unknown";
}

export interface OnboardingConfigureResult {
  device: { id: string; name: string; category: InfraDeviceCategory; ipAddresses: string[]; managementProtocols: InfraManagementProtocol[] };
  importAction: "created" | "merged";
  portProbe: PortProbeResult[];
  protocolCandidates: InfraManagementProtocol[];
  hasCredential: boolean;
  credentialProtocols: InfraManagementProtocol[];
  nextStep: string;
}

export interface OnboardingVerifyResult {
  ready: boolean;
  reason?: string;
  onlineState: string;
  detail?: string;
  failureCategory?: OnboardingFailureCategory;
  enrollmentStatus: string;
  monitoringEligible: boolean;
}

/**
 * Composes TRACE's existing discovery, device, credential, and
 * monitoring services into one coherent "onboard this device" workflow
 * (TRACE v0.6) — it owns no storage of its own and implements no new
 * connector logic; every write here is a call to a service that
 * already existed and is already independently tested. See
 * docs/ARCHITECTURE.md "Device onboarding orchestration".
 *
 * Split into two phases on purpose, matching the two points where
 * anything actually changes:
 *  - `configure` (state-changing: imports/dedupes the device, sets a
 *    *candidate* managementProtocols list from an open-port hint —
 *    never a claim of actual support) — gated by the same MCP-approval
 *    pattern as `update_device`/`request_credential_enrollment`, so
 *    exactly one human approval covers the whole configuration step.
 *  - `verify` (a real connectivity test, same no-approval precedent as
 *    `check_device_health`/`run_diagnostic` — it only ever records
 *    what a live connector call actually observed) — callable
 *    repeatedly, with no new approval needed each time, so retrying
 *    after fixing a credential costs nothing extra.
 */
@Injectable()
export class DeviceOnboardingService {
  constructor(
    @Inject(DiscoveryScanService) private readonly discoveryScan: DiscoveryScanService,
    @Inject(InfraDevicesService) private readonly devicesService: InfraDevicesService,
    @Inject(CredentialsService) private readonly credentialsService: CredentialsService,
    @Inject(DevicePollingService) private readonly devicePolling: DevicePollingService,
    @Inject(ConnectorRegistryService) private readonly connectorRegistry: ConnectorRegistryService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  async configure(environmentId: string, actor: string, dto: ConfigureOnboardingDto): Promise<OnboardingConfigureResult> {
    await this.discoveryScan.assertAuthorizedTarget(dto.ip);

    const portProbe = await this.discoveryScan.probeManagementPorts(dto.ip);
    // A hint only becomes a candidate if TRACE actually has a connector
    // for it — never assign a protocol nothing can speak to, and never
    // treat "port open" alone as "protocol confirmed" (see
    // classifyHealthFailure/`verify` for where confirmation actually
    // happens).
    const protocolCandidates = [...new Set(
      portProbe.filter((p) => p.open && this.connectorRegistry.get(p.protocolHint)).map((p) => p.protocolHint),
    )];

    const { device, action } = await this.discoveryScan.importCandidate(environmentId, actor, {
      ip: dto.ip,
      name: dto.name ?? dto.ip,
      category: dto.category ?? InfraDeviceCategory.GENERIC_NETWORK_DEVICE,
    });

    let finalDevice = device;
    const newCandidates = protocolCandidates.filter((p) => !device.managementProtocols.includes(p));
    if (newCandidates.length > 0) {
      finalDevice = await this.devicesService.update(environmentId, device.id, actor, {
        managementProtocols: [...device.managementProtocols, ...newCandidates],
      });
    }

    const allCredentials = await this.credentialsService.listForEnvironment(environmentId);
    const relevantCredentials = allCredentials.filter(
      (c) =>
        (c.deviceId === finalDevice.id || c.deviceId === null) &&
        finalDevice.managementProtocols.includes(c.protocol as InfraManagementProtocol),
    );

    await this.auditLog.record({
      environmentId,
      actor,
      action: "device.onboarding.configured",
      targetType: "InfraDevice",
      targetId: finalDevice.id,
      outcome: "success",
      detail: { ip: dto.ip, importAction: action, portProbe, protocolCandidates },
    });

    return {
      device: {
        id: finalDevice.id,
        name: finalDevice.name,
        category: finalDevice.category,
        ipAddresses: finalDevice.ipAddresses,
        managementProtocols: finalDevice.managementProtocols,
      },
      importAction: action,
      portProbe,
      protocolCandidates,
      hasCredential: relevantCredentials.length > 0,
      credentialProtocols: relevantCredentials.map((c) => c.protocol as InfraManagementProtocol),
      nextStep: this.describeNextStep(finalDevice.id, protocolCandidates, relevantCredentials.length > 0),
    };
  }

  async verify(environmentId: string, deviceId: string, actor: string): Promise<OnboardingVerifyResult> {
    const device = await this.devicesService.get(environmentId, deviceId);

    if (device.managementProtocols.length === 0) {
      return {
        ready: false,
        reason: "No management protocol set on this device yet — call trace_onboard_device, or set one manually, before verifying.",
        onlineState: device.onlineState,
        enrollmentStatus: device.enrollmentStatus,
        monitoringEligible: false,
      };
    }
    if (device.credentials.length === 0) {
      return {
        ready: false,
        reason: "No credential enrolled for this device yet — call trace_request_credential_enrollment.",
        onlineState: device.onlineState,
        enrollmentStatus: device.enrollmentStatus,
        monitoringEligible: false,
      };
    }

    const poll = await this.devicePolling.pollDevice(environmentId, deviceId);
    let enrollmentStatus: string = device.enrollmentStatus;
    if (poll.onlineState === "ONLINE") {
      const enrolled = await this.devicesService.markEnrolled(environmentId, deviceId, actor);
      enrollmentStatus = enrolled.enrollmentStatus;
    }

    return {
      ready: true,
      onlineState: poll.onlineState,
      detail: poll.detail,
      failureCategory: poll.onlineState === "ONLINE" ? undefined : classifyHealthFailure(poll.detail),
      enrollmentStatus,
      monitoringEligible: enrollmentStatus === "ENROLLED",
    };
  }

  private describeNextStep(deviceId: string, protocolCandidates: InfraManagementProtocol[], hasCredential: boolean): string {
    if (hasCredential) {
      return `Call trace_verify_device_onboarding with deviceId "${deviceId}" to test connectivity and enable monitoring.`;
    }
    if (protocolCandidates.length > 0) {
      return `No credential yet for ${protocolCandidates.join("/")} on deviceId "${deviceId}" — call trace_request_credential_enrollment for it.`;
    }
    return `No management protocol could be inferred for deviceId "${deviceId}" from the open-port probe — ask the user which protocol it actually speaks, then call trace_update_device to set managementProtocols before requesting a credential.`;
  }
}
