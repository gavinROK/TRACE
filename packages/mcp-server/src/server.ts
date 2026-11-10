import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TraceClient, TraceClientError } from "./trace-client";

type ToolResult = { content: [{ type: "text"; text: string }] };

interface DeviceSummary {
  id: string;
  name: string;
  enrollmentStatus: string;
  onlineState: string;
  lastContactAt: string | null;
  parentDevice: { id: string; name: string } | null;
}

/**
 * `server.tool(...)`'s real type is a heavily-overloaded generic
 * (`InputArgs`/`OutputArgs` conditional on `ZodRawShapeCompat |
 * AnySchema`) — registering more than a handful of object-shaped tools
 * against it sent `tsc` into a multi-minute (and sometimes
 * stack-overflowing) type-inference blowup, confirmed by timing `tsc
 * --noEmit` on this file directly (see docs/ARCHITECTURE.md "known
 * limitations"). This narrows the one call shape every tool below
 * actually uses to something cheap to check — the runtime behavior is
 * identical; zod still validates every argument at runtime regardless
 * of what TypeScript infers about it.
 */
type SimpleToolRegistrar = (
  name: string,
  description: string,
  shape: Record<string, z.ZodTypeAny>,
  cb: (args: Record<string, unknown>) => Promise<ToolResult>,
) => void;

type ZeroArgToolRegistrar = (name: string, description: string, cb: () => Promise<ToolResult>) => void;

/** Builds the MCP server and registers TRACE's tools against the given
 * client — kept separate from index.ts so this can be unit-tested with
 * a fake TraceClient, without spinning up a real stdio transport. */
export function createServer(client: TraceClient): McpServer {
  const server = new McpServer({ name: "trace-mcp", version: "0.1.0" });
  const registerTool = server.tool.bind(server) as unknown as SimpleToolRegistrar;
  const registerZeroArgTool = server.tool.bind(server) as unknown as ZeroArgToolRegistrar;

  registerZeroArgTool("trace_list_environments", "List every infrastructure environment TRACE knows about.", async () =>
    jsonResult(await guarded(() => client.listEnvironments())),
  );

  registerTool(
    "trace_list_devices",
    "List every enrolled/discovered device in one environment.",
    { environmentId: z.string() },
    async ({ environmentId }) => jsonResult(await guarded(() => client.listDevices(environmentId as string))),
  );

  registerTool(
    "trace_get_topology",
    "Get the device topology (nodes + verified/inferred relationship edges) for an environment.",
    { environmentId: z.string() },
    async ({ environmentId }) => jsonResult(await guarded(() => client.getTopology(environmentId as string))),
  );

  registerTool(
    "trace_get_device",
    "Get full detail for one device, including its capabilities and recent metrics.",
    { environmentId: z.string(), deviceId: z.string() },
    async ({ environmentId, deviceId }) =>
      jsonResult(await guarded(() => client.getDevice(environmentId as string, deviceId as string))),
  );

  registerTool(
    "trace_get_capabilities",
    "Get only the supported capabilities (protocol + operation) for one device.",
    { environmentId: z.string(), deviceId: z.string() },
    async ({ environmentId, deviceId }) => {
      const device = await guarded(() => client.getDevice(environmentId as string, deviceId as string));
      return jsonResult(device.capabilities);
    },
  );

  registerTool(
    "trace_get_health",
    "Actively check a device's reachability right now (read-only; safe to call freely).",
    { environmentId: z.string(), deviceId: z.string() },
    async ({ environmentId, deviceId }) =>
      jsonResult(await guarded(() => client.checkHealth(environmentId as string, deviceId as string))),
  );

  registerTool(
    "trace_get_metrics",
    "Get historical metric samples for a device (optionally filtered by kind, e.g. CPU_UTILIZATION).",
    {
      environmentId: z.string(),
      deviceId: z.string(),
      kind: z.string().optional(),
      sinceMinutes: z.number().optional(),
    },
    async ({ environmentId, deviceId, kind, sinceMinutes }) =>
      jsonResult(
        await guarded(() =>
          client.getMetrics(environmentId as string, deviceId as string, kind as string | undefined, sinceMinutes as number | undefined),
        ),
      ),
  );

  registerTool(
    "trace_get_logs",
    "Get the environment's audit log (logins, credential changes, commands run, actions performed).",
    { environmentId: z.string(), limit: z.number().optional() },
    async ({ environmentId, limit }) =>
      jsonResult(await guarded(() => client.getLogs(environmentId as string, limit as number | undefined))),
  );

  registerTool(
    "trace_execute_command",
    "Propose running a shell command on one device over SSH. This never executes immediately — it creates a pending action that a human must approve in TRACE's own dashboard (Settings → Pending approvals) before it runs. The result includes a pendingActionId; call trace_get_pending_action_status with it to check whether a human has approved/rejected it yet and, once executed, see the real result.",
    {
      environmentId: z.string(),
      deviceName: z.string(),
      command: z.string(),
      timeoutMs: z.number().optional(),
    },
    async ({ environmentId, deviceName, command, timeoutMs }) =>
      jsonResult(
        await guarded(() =>
          client.executeCommand(environmentId as string, deviceName as string, command as string, timeoutMs as number | undefined),
        ),
      ),
  );

  registerTool(
    "trace_execute_group_command",
    "Propose running a shell command across multiple devices. Like trace_execute_command, this never executes immediately — it creates one pending action a human must approve in TRACE's dashboard before it runs against any device; `confirm` has no effect on that gate. Use trace_get_pending_action_status to check the outcome.",
    {
      environmentId: z.string(),
      deviceNames: z.array(z.string()),
      command: z.string(),
      timeoutMs: z.number().optional(),
      confirm: z.boolean().optional(),
    },
    async ({ environmentId, deviceNames, command, timeoutMs, confirm }) =>
      jsonResult(
        await guarded(() =>
          client.executeGroupCommand(
            environmentId as string,
            deviceNames as string[],
            command as string,
            timeoutMs as number | undefined,
            confirm as boolean | undefined,
          ),
        ),
      ),
  );

  registerTool(
    "trace_perform_action",
    "Propose a management action on a device. This never executes immediately — it creates a pending action a human must approve in TRACE's dashboard before it runs; `confirm` has no effect on that gate. Use trace_get_pending_action_status to check the outcome. " +
      "Proxmox VMs: start (ADMINISTRATIVE), stop/shutdown/reboot (DESTRUCTIVE). " +
      "SSH hosts: service_start/service_enable/service_disable/package_install (ADMINISTRATIVE, pass params:{service} or params:{package}), service_stop/service_restart (DESTRUCTIVE, params:{service}), reboot (DESTRUCTIVE). " +
      "Every identifier in params (service/package name) must be a plain name — no spaces or shell metacharacters; the connector rejects anything else before it ever reaches a shell.",
    {
      environmentId: z.string(),
      deviceId: z.string(),
      action: z.string(),
      confirm: z.boolean().optional(),
      params: z.record(z.unknown()).optional(),
    },
    async ({ environmentId, deviceId, action, confirm, params }) =>
      jsonResult(
        await guarded(() =>
          client.performAction(
            environmentId as string,
            deviceId as string,
            action as string,
            confirm as boolean | undefined,
            params as Record<string, unknown> | undefined,
          ),
        ),
      ),
  );

  registerTool(
    "trace_get_operation_status",
    "Get the status/result of a previously started command run (from trace_execute_command).",
    { environmentId: z.string(), runId: z.string() },
    async ({ environmentId, runId }) =>
      jsonResult(await guarded(() => client.getOperationStatus(environmentId as string, runId as string))),
  );

  registerTool(
    "trace_diagnose_device",
    "Explain exactly why a device isn't connected — missing management address, missing credential, or genuinely unreachable — rather than a generic error. Use this before trace_execute_command on a device you haven't verified is enrolled.",
    { environmentId: z.string(), deviceId: z.string() },
    async ({ environmentId, deviceId }) => {
      const device = await guarded(() => client.getDevice(environmentId as string, deviceId as string));
      const diagnosis: string[] = [`Device: ${device.name}`, `Status: ${device.enrollmentStatus} / ${device.onlineState}`];
      if (device.ipAddresses.length === 0) {
        diagnosis.push("Missing: a management IP address or hostname — set one from the device's settings panel.");
      } else if (device.credentials.length === 0) {
        diagnosis.push(`Missing: a credential — add one for one of ${device.managementProtocols.join(", ") || "a supported protocol"}.`);
      } else if (device.capabilities.length === 0) {
        diagnosis.push("A management address and credential are set, but no capability is available yet — check the credential's protocol matches an enrolled management protocol.");
      } else {
        diagnosis.push(`Ready: ${device.capabilities.map((c) => `${c.protocol}:${c.capability}`).join(", ")}. If onlineState is still OFFLINE/UNKNOWN, call trace_get_health to check reachability right now.`);
      }
      return jsonResult({ device: { id: device.id, name: device.name, ipAddresses: device.ipAddresses, enrollmentStatus: device.enrollmentStatus, onlineState: device.onlineState }, diagnosis: diagnosis.join("\n") });
    },
  );

  registerTool(
    "trace_detect_local_network",
    "Detect the local machine's active network interface, subnet, and default gateway — the first step of network discovery.",
    { environmentId: z.string() },
    async ({ environmentId }) => jsonResult(await guarded(() => client.detectLocalNetwork(environmentId as string))),
  );

  registerTool(
    "trace_scan_network",
    "Scan a subnet for devices (ARP/neighbor-table inspection plus an optional nmap ping sweep — no port scanning). The subnet must be one TRACE's own machine is on; call trace_detect_local_network first to find it. Only scans what's passed in cidr.",
    { environmentId: z.string(), cidr: z.string().optional() },
    async ({ environmentId, cidr }) => jsonResult(await guarded(() => client.scanNetwork(environmentId as string, cidr as string | undefined))),
  );

  registerTool(
    "trace_update_device",
    "Update a device's non-secret inventory settings (name, category, IP addresses, management port/protocols, tags, notes). Never accepts or stores a credential — use the TRACE UI to enroll one.",
    {
      environmentId: z.string(),
      deviceId: z.string(),
      name: z.string().optional(),
      category: z.string().optional(),
      ipAddresses: z.array(z.string()).optional(),
      managementPort: z.number().optional(),
      managementProtocols: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
    },
    async ({ environmentId, deviceId, ...patch }) =>
      jsonResult(await guarded(() => client.updateDevice(environmentId as string, deviceId as string, patch))),
  );

  registerTool(
    "trace_run_diagnostic",
    "Run one read-only inspection on a device (SSH hosts today). Never requires approval — every name below is non-mutating by construction, same guarantee as trace_get_health. Names: os_info, cpu_memory_disk, network_interfaces, process_list, package_inventory, firewall_rules, filesystem_info (no params); service_status (params:{service}) and system_logs (params:{unit?, lines?}, unit/service must be a plain identifier, no shell metacharacters); security_posture (no params — returns structured findings: PermitRootLogin/PasswordAuthentication sshd config, failed-login count, pending package updates, world-writable files under /etc). Use this before trace_perform_action to understand what you're about to change, and again afterward to verify the outcome.",
    {
      environmentId: z.string(),
      deviceId: z.string(),
      name: z.enum([
        "os_info",
        "cpu_memory_disk",
        "network_interfaces",
        "service_status",
        "system_logs",
        "process_list",
        "package_inventory",
        "firewall_rules",
        "filesystem_info",
        "security_posture",
      ]),
      params: z.record(z.unknown()).optional(),
    },
    async ({ environmentId, deviceId, name, params }) =>
      jsonResult(
        await guarded(() => client.runDiagnostic(environmentId as string, deviceId as string, name as string, params as Record<string, unknown> | undefined)),
      ),
  );

  registerTool(
    "trace_get_pending_action_status",
    "Check whether a pending action (from trace_execute_command, trace_execute_group_command, or trace_perform_action) has been approved, rejected, or is still awaiting a human in TRACE's dashboard. Read-only — this cannot approve anything itself.",
    { environmentId: z.string(), pendingActionId: z.string() },
    async ({ environmentId, pendingActionId }) =>
      jsonResult(await guarded(() => client.getPendingActionStatus(environmentId as string, pendingActionId as string))),
  );

  registerTool(
    "trace_list_unenrolled_devices",
    "List devices TRACE has discovered but that are not yet enrolled (no working credential/connection verified yet).",
    { environmentId: z.string() },
    async ({ environmentId }) => {
      const devices = await guarded(() => client.listDevices(environmentId as string)) as DeviceSummary[];
      return jsonResult(devices.filter((d) => d.enrollmentStatus === "DISCOVERED"));
    },
  );

  registerTool(
    "trace_get_vm_inventory",
    "List the VMs/containers hosted on a given hypervisor device (its children in TRACE's inventory). Pure read of already-known inventory — does not trigger a new discovery scan; call trace_scan_network or the TRACE UI's Discover flow for that.",
    { environmentId: z.string(), hypervisorDeviceId: z.string() },
    async ({ environmentId, hypervisorDeviceId }) => {
      const devices = await guarded(() => client.listDevices(environmentId as string)) as DeviceSummary[];
      return jsonResult(devices.filter((d) => d.parentDevice?.id === hypervisorDeviceId));
    },
  );

  registerTool(
    "trace_request_credential_enrollment",
    "Request a temporary, 5-minute window for a human to enroll a credential (SSH username/password/key, Proxmox API token, SNMPv3 keys, ...) for one device — the secret itself never passes through this tool call, this conversation, or TRACE's API in either direction. Disabled by default: fails with a clear message unless an operator has set TRACE_CREDENTIAL_ENROLLMENT_ENABLED=true. This never executes immediately — it creates a pending action a human must approve in TRACE's dashboard (Settings → Pending approvals); approving it is what opens the window, during which the human types the credential directly into the device's panel in TRACE's own UI, never here. Poll trace_get_credential_enrollment_status to see when they've finished, then call trace_get_health to verify the new credential actually works.",
    {
      environmentId: z.string(),
      deviceId: z.string(),
      protocol: z.string().describe("e.g. SSH, PROXMOX_API, SNMP_V3"),
      label: z.string().optional().describe('Optional display label for the credential, e.g. "router-ssh".'),
    },
    async ({ environmentId, deviceId, protocol, label }) =>
      jsonResult(
        await guarded(() =>
          client.requestCredentialEnrollment(environmentId as string, deviceId as string, protocol as string, label as string | undefined),
        ),
      ),
  );

  registerTool(
    "trace_get_credential_enrollment_status",
    "Check the status of the most recent credential-enrollment window for one device (AUTHORIZED and counting down, COMPLETED, EXPIRED, or REVOKED) — from trace_request_credential_enrollment. Read-only and never returns a secret; safe to call freely, same as trace_get_health. Returns null if none has ever been requested for this device.",
    { environmentId: z.string(), deviceId: z.string() },
    async ({ environmentId, deviceId }) =>
      jsonResult(await guarded(() => client.getCredentialEnrollmentStatus(environmentId as string, deviceId as string))),
  );

  registerTool(
    "trace_onboard_device",
    "TRACE v0.6: discover and configure a device by IP in one step. Probes a small curated set of well-known management ports (SSH 22, Proxmox 8006, WinRM 5985/5986 — never SNMP, which is UDP), imports/dedupes it into inventory (reuses existing inventory by IP rather than creating a duplicate), and sets any protocol candidate TRACE actually has a connector for. This never claims a protocol is truly supported just because its port answered — that candidate still has to pass trace_verify_device_onboarding. Refuses an IP outside the subnet TRACE's own machine is actually on. This never executes immediately — it creates a pending action a human must approve in TRACE's dashboard (Settings → Pending approvals), bound to exactly the ip/name/category given. The result's nextStep tells you whether to call trace_request_credential_enrollment or trace_verify_device_onboarding next.",
    {
      environmentId: z.string(),
      ip: z.string(),
      name: z.string().optional().describe("Optional display name; defaults to the IP."),
      category: z.string().optional().describe("Optional InfraDeviceCategory, e.g. ROUTER, PHYSICAL_SERVER."),
    },
    async ({ environmentId, ip, name, category }) =>
      jsonResult(
        await guarded(() =>
          client.onboardDevice(environmentId as string, ip as string, name as string | undefined, category as string | undefined),
        ),
      ),
  );

  registerTool(
    "trace_verify_device_onboarding",
    "TRACE v0.6: run a real connectivity test against a device using its already-stored credential, and — only if it actually comes back ONLINE — mark it ENROLLED, which is what makes TRACE's scheduled health/metrics polling start covering it automatically. Never requires approval (same precedent as trace_get_health): it only ever records what a live connector call actually observed. If the result isn't ONLINE, failureCategory gives a best-effort authentication/unreachable/host-key-mismatch/unknown distinction. Safe to call repeatedly — e.g. right after a human finishes a credential-enrollment window from trace_request_credential_enrollment.",
    { environmentId: z.string(), deviceId: z.string() },
    async ({ environmentId, deviceId }) =>
      jsonResult(await guarded(() => client.verifyDeviceOnboarding(environmentId as string, deviceId as string))),
  );

  registerTool(
    "trace_list_alerts",
    "List active alerts. Honest about a real gap: TRACE's infrastructure control plane has no threshold-based alerting/notification engine yet — this reports that limitation plainly, plus the closest available signals (devices currently OFFLINE and the recent audit log), instead of inventing alerts that don't exist.",
    { environmentId: z.string() },
    async ({ environmentId }) => {
      const [devices, auditLog] = await Promise.all([
        guarded(() => client.listDevices(environmentId as string)) as Promise<DeviceSummary[]>,
        guarded(() => client.getLogs(environmentId as string, 20)),
      ]);
      return jsonResult({
        alertingImplemented: false,
        limitation:
          "TRACE's infrastructure control plane does not have a threshold-based alerting/notification engine yet. The closest available signals are: devices currently reported OFFLINE, and the recent audit log.",
        devicesCurrentlyOffline: devices.filter((d) => d.onlineState === "OFFLINE").map((d) => ({ id: d.id, name: d.name, lastContactAt: d.lastContactAt })),
        recentAuditLog: auditLog,
      });
    },
  );

  return server;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TraceClientError) {
      throw new Error(`TRACE API error (${error.status}): ${error.message}`);
    }
    throw error;
  }
}

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
