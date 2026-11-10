import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { AiActionClassification, InfraManagementProtocol } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";
import { ActionsService, DESTRUCTIVE_ACTIONS } from "../actions/actions.service";
import { CommandExecutionService } from "../console/command-execution.service";
import { CredentialEnrollmentService } from "../credentials/credential-enrollment.service";
import { InfraDevicesService } from "../devices/devices.service";
import { DiscoveryScanService } from "../discovery/discovery-scan.service";
import { EnvironmentsService } from "../environments/environments.service";
import { DevicePollingService } from "../monitoring/device-polling.service";
import { DeviceOnboardingService } from "../onboarding/device-onboarding.service";
import { TopologyService } from "../topology/topology.service";
import type { AiToolDefinition } from "./providers/ai-provider.interface";

/**
 * The AI assistant's entire capability surface. Every handler below
 * calls an existing, controller-reachable TRACE service method — the
 * exact same code path the browser UI and the MCP server already use
 * (PRODUCT_SPEC v0.3 section 4: "Do not implement separate Proxmox,
 * SSH, or SNMP clients inside the AI subsystem"). Nothing here talks to
 * a connector, a credential, or a database row this registry doesn't
 * already have a service method for.
 *
 * Capabilities the product brief names that TRACE genuinely does not
 * implement yet (VM/container provisioning, Windows/WinRM, Docker API,
 * vendor-specific switch configuration, a real alerting/threshold
 * engine) are deliberately NOT given a tool here — see
 * UNSUPPORTED_CAPABILITIES_NOTE, folded into the system prompt in
 * ai-chat.service.ts, so the model explains the gap in plain language
 * instead of calling a tool that would have to fake success.
 */
export const UNSUPPORTED_CAPABILITIES_NOTE = `TRACE does not yet support (say so plainly if asked, never pretend otherwise):
- Creating or provisioning new VMs/containers (only start/stop/shutdown/reboot of EXISTING ones, via perform_action)
- Windows (WinRM) or Docker API management — no connector exists for either yet
- Vendor-specific network device configuration changes (e.g. switch port config) — SNMP access is read-only by design
- A threshold-based alerting/notification system — list_alerts explains this gap when asked
- Interface error-counter collection (ifInErrors/ifOutErrors) on SNMP devices — only link speed and uptime are currently collected`;

export const AI_ACTION_CLASSIFICATION: Record<string, AiActionClassification> = {
  list_environments: AiActionClassification.READ_ONLY,
  list_devices: AiActionClassification.READ_ONLY,
  get_device: AiActionClassification.READ_ONLY,
  list_unenrolled_devices: AiActionClassification.READ_ONLY,
  get_topology: AiActionClassification.READ_ONLY,
  check_device_health: AiActionClassification.READ_ONLY,
  get_device_metrics: AiActionClassification.READ_ONLY,
  get_vm_inventory: AiActionClassification.READ_ONLY,
  get_audit_log: AiActionClassification.READ_ONLY,
  list_alerts: AiActionClassification.READ_ONLY,
  diagnose_device: AiActionClassification.READ_ONLY,
  detect_local_network: AiActionClassification.READ_ONLY,
  scan_network: AiActionClassification.READ_ONLY,
  execute_command: AiActionClassification.ADMINISTRATIVE,
  execute_group_command: AiActionClassification.ADMINISTRATIVE,
  update_device: AiActionClassification.ADMINISTRATIVE,
  request_credential_enrollment: AiActionClassification.ADMINISTRATIVE,
  onboard_device: AiActionClassification.ADMINISTRATIVE,
  verify_device_onboarding: AiActionClassification.READ_ONLY,
  // perform_action is classified dynamically — see classifyPerformAction.
};

/** `perform_action`'s classification depends on the action name, not
 * just the tool name — "start" is administrative, "stop"/"shutdown"/
 * "reboot" are destructive, mirroring ActionsService's own
 * DESTRUCTIVE_ACTIONS exactly (imported, not duplicated). */
export function classifyToolCall(toolName: string, input: Record<string, unknown>): AiActionClassification {
  if (toolName === "perform_action") {
    const action = typeof input.action === "string" ? input.action : "";
    return DESTRUCTIVE_ACTIONS.has(action) ? AiActionClassification.DESTRUCTIVE : AiActionClassification.ADMINISTRATIVE;
  }
  return AI_ACTION_CLASSIFICATION[toolName] ?? AiActionClassification.DESTRUCTIVE; // unknown tool: fail safe, never auto-run
}

export const AI_TOOL_DEFINITIONS: AiToolDefinition[] = [
  {
    name: "list_environments",
    description: "List every infrastructure environment TRACE knows about.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_devices",
    description: "List every enrolled/discovered device in the current environment, with status and capabilities summary.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_device",
    description: "Get full detail for one device: identity, IPs, protocols, capabilities, credentials metadata (never a secret), and its 50 most recent metric samples.",
    inputSchema: { type: "object", properties: { deviceId: { type: "string" } }, required: ["deviceId"] },
  },
  {
    name: "list_unenrolled_devices",
    description: "List devices TRACE has discovered but that are not yet enrolled (no working credential/connection verified).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_topology",
    description: "Get the full device topology graph: nodes plus relationship edges, each tagged VERIFIED (observed by a connector) or INFERRED (a best-effort guess). To answer a question about the path between two specific devices, fetch this and reason over the subgraph yourself — there is no separate subgraph-only endpoint.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_device_health",
    description: "Actively probe one device right now (read-only — it does not change the device). Updates and returns its online/offline state and collects a fresh metrics sample if the device is reachable.",
    inputSchema: { type: "object", properties: { deviceId: { type: "string" } }, required: ["deviceId"] },
  },
  {
    name: "get_device_metrics",
    description: "Get historical metric samples for a device over a time window. Only returns metric kinds TRACE's connectors actually collect for that device's protocol (e.g. SNMP devices currently only report link speed and uptime, not interface error counts).",
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" },
        kind: { type: "string", description: "Optional: one InfraMetricKind, e.g. CPU_UTILIZATION, MEMORY_UTILIZATION, DISK_UTILIZATION." },
        sinceMinutes: { type: "number", description: "How far back to look. Defaults to 1440 (24h)." },
      },
      required: ["deviceId"],
    },
  },
  {
    name: "get_vm_inventory",
    description: "List the VMs/containers hosted on a given hypervisor device (its children in TRACE's inventory). Pure read of already-known inventory — does not trigger a new discovery scan.",
    inputSchema: { type: "object", properties: { hypervisorDeviceId: { type: "string" } }, required: ["hypervisorDeviceId"] },
  },
  {
    name: "get_audit_log",
    description: "Get the environment's audit log (logins, credential changes, commands run, actions performed, AI tool calls).",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "list_alerts",
    description: "List active alerts. Honest about a real gap: TRACE's infrastructure control plane has no threshold-based alerting/notification engine yet — call this to get that limitation explained, with the closest available signals (recent audit log entries and current device online/offline state) instead of guessing at alerts that don't exist.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "diagnose_device",
    description: "Explain exactly why a device isn't connected — missing management address, missing credential, or genuinely unreachable — instead of a generic error. Use this before execute_command on a device you haven't verified is enrolled.",
    inputSchema: { type: "object", properties: { deviceId: { type: "string" } }, required: ["deviceId"] },
  },
  {
    name: "detect_local_network",
    description: "Detect the TRACE server's own active network interface, subnet, and default gateway — the first step of network discovery.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "scan_network",
    description: "Scan a subnet for devices (ARP/neighbor-table inspection plus an optional nmap ping sweep — no port scanning). Read-only: it does not enroll anything it finds. Omit cidr to scan TRACE's own detected subnet.",
    inputSchema: { type: "object", properties: { cidr: { type: "string" } } },
  },
  {
    name: "execute_command",
    description: "Run a shell command on one device over SSH. ADMINISTRATIVE — requires explicit user approval before it runs; proposing this call does not execute it.",
    inputSchema: {
      type: "object",
      properties: { deviceName: { type: "string" }, command: { type: "string" }, timeoutMs: { type: "number" } },
      required: ["deviceName", "command"],
    },
  },
  {
    name: "execute_group_command",
    description: "Run a shell command across multiple devices. ADMINISTRATIVE — requires explicit user approval before it runs.",
    inputSchema: {
      type: "object",
      properties: {
        deviceNames: { type: "array", items: { type: "string" } },
        command: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["deviceNames", "command"],
    },
  },
  {
    name: "perform_action",
    description: "Perform a management action on a device, e.g. start/stop/reboot a Proxmox VM. ADMINISTRATIVE for non-disruptive actions (start); DESTRUCTIVE for stop/shutdown/reboot. Either way requires explicit user approval before it runs.",
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" },
        action: { type: "string", description: "e.g. start, stop, shutdown, reboot" },
        params: { type: "object" },
      },
      required: ["deviceId", "action"],
    },
  },
  {
    name: "update_device",
    description: "Update a device's non-secret inventory settings (name, category, IPs, management port/protocols, tags, notes). Never accepts or stores a credential. ADMINISTRATIVE — requires explicit user approval before it runs.",
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" },
        name: { type: "string" },
        category: { type: "string" },
        ipAddresses: { type: "array", items: { type: "string" } },
        managementPort: { type: "number" },
        managementProtocols: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
      },
      required: ["deviceId"],
    },
  },
  {
    name: "request_credential_enrollment",
    description:
      "Request a temporary, 5-minute window for a human to enroll a credential (SSH username/password/key, Proxmox API token, SNMPv3 keys, ...) for one device, without the secret ever passing through this conversation. Disabled by default — fails with a clear message if TRACE_CREDENTIAL_ENROLLMENT_ENABLED is not set. ADMINISTRATIVE — requires explicit user approval; approving it is what starts the 5-minute window, and the human then types the credential directly into TRACE's device panel, never here. Poll trace_get_credential_enrollment_status (or get_device) to find out when they've finished, then test with check_device_health.",
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" },
        protocol: { type: "string", description: "e.g. SSH, PROXMOX_API, SNMP_V3" },
        label: { type: "string", description: "Optional display label for the credential, e.g. \"router-ssh\"." },
      },
      required: ["deviceId", "protocol"],
    },
  },
  {
    name: "onboard_device",
    description:
      "Discover and configure a device by IP in one step: probes a small set of well-known management ports (SSH 22, Proxmox 8006, WinRM 5985/5986 — never SNMP, it's UDP), imports/dedupes it into inventory, and sets any protocol candidates a connector actually exists for. Never assumes a protocol is actually supported just because its port is open — that candidate must still pass verify_device_onboarding before it counts. Refuses an IP outside the subnet TRACE's own machine is on. ADMINISTRATIVE — requires explicit user approval, bound to the exact ip/name/category given. Returns a nextStep telling you whether to request a credential or verify connectivity.",
    inputSchema: {
      type: "object",
      properties: {
        ip: { type: "string" },
        name: { type: "string", description: "Optional display name; defaults to the IP." },
        category: { type: "string", description: "Optional InfraDeviceCategory, e.g. ROUTER, PHYSICAL_SERVER." },
      },
      required: ["ip"],
    },
  },
  {
    name: "verify_device_onboarding",
    description:
      "Run a real connectivity test against a device using its already-stored credential, and — only if it actually comes back ONLINE — mark the device ENROLLED, which is what makes TRACE's scheduled health/metrics polling pick it up automatically. Read-only in the sense that it never requires approval (same precedent as check_device_health), but it does record what it observes, same as that tool. If onlineState isn't ONLINE, failureCategory distinguishes authentication/unreachable/host-key-mismatch/unknown on a best-effort basis. Safe to call repeatedly — e.g. right after a human finishes a credential-enrollment window.",
    inputSchema: {
      type: "object",
      properties: { deviceId: { type: "string" } },
      required: ["deviceId"],
    },
  },
];

export interface ToolCallContext {
  environmentId: string;
  actor: string;
}

/**
 * Executes one already-approved tool call. The caller (ai-chat.service.ts)
 * is responsible for the approval gate — by the time `run` is called for
 * an ADMINISTRATIVE/DESTRUCTIVE tool, a human has already approved it
 * via AiPendingAction; this class has no concept of "pending" and will
 * run anything it's asked to run, same as CommandExecutionService or
 * ActionsService themselves have no opinion about approval — that
 * policy lives one layer up, exactly once.
 */
@Injectable()
export class AiToolsRegistryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EnvironmentsService) private readonly environmentsService: EnvironmentsService,
    @Inject(InfraDevicesService) private readonly devicesService: InfraDevicesService,
    @Inject(DevicePollingService) private readonly devicePollingService: DevicePollingService,
    @Inject(TopologyService) private readonly topologyService: TopologyService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService,
    @Inject(CommandExecutionService) private readonly commandExecutionService: CommandExecutionService,
    @Inject(ActionsService) private readonly actionsService: ActionsService,
    @Inject(DiscoveryScanService) private readonly discoveryScanService: DiscoveryScanService,
    @Inject(CredentialEnrollmentService) private readonly credentialEnrollmentService: CredentialEnrollmentService,
    @Inject(DeviceOnboardingService) private readonly deviceOnboardingService: DeviceOnboardingService,
  ) {}

  async run(toolName: string, input: Record<string, unknown>, ctx: ToolCallContext): Promise<unknown> {
    const handler = this.handlers[toolName];
    if (!handler) throw new BadRequestException(`Unknown tool "${toolName}"`);
    return handler(input, ctx);
  }

  private readonly handlers: Record<string, (input: Record<string, unknown>, ctx: ToolCallContext) => Promise<unknown>> = {
    list_environments: async () => this.environmentsService.list(),

    list_devices: async (_input, ctx) => this.devicesService.list(ctx.environmentId),

    get_device: async (input, ctx) => this.devicesService.get(ctx.environmentId, requireString(input, "deviceId")),

    list_unenrolled_devices: async (_input, ctx) => {
      const devices = await this.devicesService.list(ctx.environmentId);
      return devices.filter((d) => d.enrollmentStatus === "DISCOVERED");
    },

    get_topology: async (_input, ctx) => this.topologyService.getSnapshot(ctx.environmentId),

    check_device_health: async (input, ctx) =>
      this.devicePollingService.pollDevice(ctx.environmentId, requireString(input, "deviceId")),

    get_device_metrics: async (input, ctx) => {
      const deviceId = requireString(input, "deviceId");
      const kind = typeof input.kind === "string" ? input.kind : undefined;
      const sinceMinutes = typeof input.sinceMinutes === "number" ? input.sinceMinutes : 1440;
      const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
      // Scoped through `device.environmentId`, unlike MetricsController's
      // own equivalent query (pre-existing, unrelated to this feature) —
      // worth the extra join here since a model-supplied deviceId is less
      // trustworthy than one a human typed into a URL they already own.
      return this.prisma.infraMetricSample.findMany({
        where: { deviceId, device: { environmentId: ctx.environmentId }, kind: kind as never, collectedAt: { gte: since } },
        orderBy: { collectedAt: "asc" },
      });
    },

    get_vm_inventory: async (input, ctx) => {
      const hypervisorDeviceId = requireString(input, "hypervisorDeviceId");
      const devices = await this.devicesService.list(ctx.environmentId);
      return devices.filter((d) => d.parentDevice?.id === hypervisorDeviceId);
    },

    get_audit_log: async (input, ctx) => {
      const limit = typeof input.limit === "number" ? input.limit : 200;
      return this.auditLogService.listForEnvironment(ctx.environmentId, limit);
    },

    list_alerts: async (_input, ctx) => {
      const [devices, recentAudit] = await Promise.all([
        this.devicesService.list(ctx.environmentId),
        this.auditLogService.listForEnvironment(ctx.environmentId, 20),
      ]);
      const offline = devices.filter((d) => d.onlineState === "OFFLINE");
      return {
        alertingImplemented: false,
        limitation:
          "TRACE's infrastructure control plane does not have a threshold-based alerting/notification engine yet. The closest available signals are: devices currently reported OFFLINE, and the recent audit log.",
        devicesCurrentlyOffline: offline.map((d) => ({ id: d.id, name: d.name, lastContactAt: d.lastContactAt })),
        recentAuditLog: recentAudit,
      };
    },

    diagnose_device: async (input, ctx) => {
      const deviceId = requireString(input, "deviceId");
      const device = await this.devicesService.get(ctx.environmentId, deviceId);
      const diagnosis: string[] = [`Device: ${device.name}`, `Status: ${device.enrollmentStatus} / ${device.onlineState}`];
      if (device.ipAddresses.length === 0) {
        diagnosis.push("Missing: a management IP address or hostname — set one from the device's settings panel.");
      } else if (device.credentials.length === 0) {
        diagnosis.push(`Missing: a credential — add one for one of ${device.managementProtocols.join(", ") || "a supported protocol"}.`);
      } else if (device.capabilities.length === 0) {
        diagnosis.push("A management address and credential are set, but no capability is available yet — check the credential's protocol matches an enrolled management protocol.");
      } else {
        diagnosis.push(
          `Ready: ${device.capabilities.map((c) => `${c.protocol}:${c.capability}`).join(", ")}. If onlineState is still OFFLINE/UNKNOWN, call check_device_health to check reachability right now.`,
        );
      }
      return { device: { id: device.id, name: device.name, ipAddresses: device.ipAddresses, enrollmentStatus: device.enrollmentStatus, onlineState: device.onlineState }, diagnosis: diagnosis.join("\n") };
    },

    detect_local_network: async () => this.discoveryScanService.detectLocalNetwork(),

    scan_network: async (input, ctx) => {
      const cidr = typeof input.cidr === "string" ? input.cidr : undefined;
      return this.discoveryScanService.scanSubnet(ctx.environmentId, cidr);
    },

    execute_command: async (input, ctx) => {
      const deviceName = requireString(input, "deviceName");
      const command = requireString(input, "command");
      const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : undefined;
      return this.commandExecutionService.executeOnDevice(ctx.environmentId, ctx.actor, deviceName, command, timeoutMs);
    },

    execute_group_command: async (input, ctx) => {
      const deviceNames = requireStringArray(input, "deviceNames");
      const command = requireString(input, "command");
      const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : undefined;
      return this.commandExecutionService.executeOnGroup(ctx.environmentId, ctx.actor, deviceNames, command, timeoutMs);
    },

    perform_action: async (input, ctx) => {
      const deviceId = requireString(input, "deviceId");
      const action = requireString(input, "action");
      const params = (input.params as Record<string, unknown> | undefined) ?? undefined;
      // Already approved by the time `run` is called (see approvals/approvals.service.ts) —
      // confirmed:true here reflects that human approval, not model self-approval.
      return this.actionsService.performAction(ctx.environmentId, ctx.actor, deviceId, action, params, true);
    },

    update_device: async (input, ctx) => {
      const deviceId = requireString(input, "deviceId");
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "category", "ipAddresses", "managementPort", "managementProtocols", "tags", "notes"]) {
        if (key in input) patch[key] = input[key];
      }
      return this.devicesService.update(ctx.environmentId, deviceId, ctx.actor, patch);
    },

    // Runs once a human approves the proposing pending action (see
    // credentials/credential-enrollment.controller.ts `propose`) —
    // `ctx.actor` at this point is that approver's own browser-session
    // actor string (resolveApproval in ai-chat.service.ts passes
    // `decidedBy`), never the MCP actor, which is what lets
    // authorizeSession treat it as the human's own authorization.
    request_credential_enrollment: async (input, ctx) => {
      const deviceId = requireString(input, "deviceId");
      const protocolInput = requireString(input, "protocol");
      if (!Object.values(InfraManagementProtocol).includes(protocolInput as InfraManagementProtocol)) {
        throw new BadRequestException(`"protocol" must be one of ${Object.values(InfraManagementProtocol).join(", ")}`);
      }
      const label = typeof input.label === "string" ? input.label : undefined;
      return this.credentialEnrollmentService.authorizeSession(
        ctx.environmentId,
        deviceId,
        protocolInput as InfraManagementProtocol,
        label,
        ctx.actor,
      );
    },

    // Runs once a human approves the proposing pending action (see
    // onboarding/device-onboarding.controller.ts `configure`) —
    // `ctx.actor` is that approver's own browser-session actor.
    onboard_device: async (input, ctx) => {
      const ip = requireString(input, "ip");
      const name = typeof input.name === "string" ? input.name : undefined;
      const category = typeof input.category === "string" ? (input.category as never) : undefined;
      return this.deviceOnboardingService.configure(ctx.environmentId, ctx.actor, { ip, name, category });
    },

    // READ_ONLY — never gated, same as check_device_health. Runs
    // directly, not through the approval dispatcher.
    verify_device_onboarding: async (input, ctx) => {
      const deviceId = requireString(input, "deviceId");
      return this.deviceOnboardingService.verify(ctx.environmentId, deviceId, ctx.actor);
    },
  };
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new BadRequestException(`"${key}" is required`);
  return value;
}

function requireStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new BadRequestException(`"${key}" must be an array of strings`);
  }
  return value as string[];
}
