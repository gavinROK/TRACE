import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TraceClient, TraceClientError } from "./trace-client";

type ToolResult = { content: [{ type: "text"; text: string }] };

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
    "Run a shell command on one device over SSH. Requires the device to have an SSH credential enrolled.",
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
    "Run a shell command across multiple devices with bounded concurrency. Running against more than one device requires confirm: true.",
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
    "Perform a management action on a device (e.g. start/stop/reboot a Proxmox VM). Destructive actions (stop, shutdown, reboot) require confirm: true.",
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
