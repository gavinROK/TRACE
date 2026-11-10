import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server";
import { TraceClient } from "./trace-client";

/**
 * This is the real test that Claude can discover TRACE's tools and run
 * one — a real MCP Client (the same class Claude Code's MCP integration
 * uses) talks the actual MCP protocol to a real McpServer over a real
 * transport, in-process. Only the HTTP layer underneath TraceClient is
 * faked (global fetch), since there's no live TRACE API/Postgres in
 * this environment — see README.md "What's tested" for what remains to
 * verify against a running `npm run dev` stack.
 */
describe("TRACE MCP server (end-to-end over the real MCP protocol)", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock;
  });

  async function connectedClient() {
    const traceClient = new TraceClient({ baseUrl: "http://localhost:4000", serviceToken: "test-token" });
    const server = createServer(traceClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it("lists all registered tools — tool discovery, matching PRODUCT_SPEC.md section 11 plus TRACE v0.4's additions", async () => {
    const client = await connectedClient();

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "trace_execute_command",
        "trace_execute_group_command",
        "trace_get_capabilities",
        "trace_get_device",
        "trace_get_health",
        "trace_get_logs",
        "trace_get_metrics",
        "trace_get_operation_status",
        "trace_get_pending_action_status",
        "trace_get_topology",
        "trace_get_vm_inventory",
        "trace_list_alerts",
        "trace_list_devices",
        "trace_list_environments",
        "trace_list_unenrolled_devices",
        "trace_perform_action",
        "trace_diagnose_device",
        "trace_detect_local_network",
        "trace_scan_network",
        "trace_update_device",
      ].sort(),
    );
  });

  it("executes a harmless read-only operation (trace_list_environments) end to end", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "env1", name: "Gavin's Home Infrastructure", slug: "home", deviceCount: 3 }],
    });
    const client = await connectedClient();

    const result = await client.callTool({ name: "trace_list_environments", arguments: {} });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual([{ id: "env1", name: "Gavin's Home Infrastructure", slug: "home", deviceCount: 3 }]);
  });

  it("passes structured arguments through to the right REST call for a device-scoped tool", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ onlineState: "ONLINE" }) });
    const client = await connectedClient();

    await client.callTool({ name: "trace_get_health", arguments: { environmentId: "env1", deviceId: "dev1" } });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/infra/environments/env1/devices/dev1/check-health",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("diagnoses a device missing a management address, instead of a generic error", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "dev1",
        name: "Beelink",
        category: "PHYSICAL_SERVER",
        ipAddresses: [],
        managementProtocols: [],
        enrollmentStatus: "DISCOVERED",
        onlineState: "UNKNOWN",
        capabilities: [],
        credentials: [],
      }),
    });
    const client = await connectedClient();

    const result = await client.callTool({ name: "trace_diagnose_device", arguments: { environmentId: "env1", deviceId: "dev1" } });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text).diagnosis).toContain("Missing: a management IP address");
  });

  it("surfaces a TRACE API error as a tool error rather than crashing the server", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found", json: async () => ({ message: "Device not found" }) });
    const client = await connectedClient();

    const result = await client.callTool({ name: "trace_get_device", arguments: { environmentId: "env1", deviceId: "missing" } });

    expect(result.isError).toBe(true);
  });

  describe("TRACE v0.4 — MCP tool execution is approval-gated, matching the native assistant's security controls", () => {
    it("trace_perform_action never executes directly — it passes through the backend's pending-approval response as-is", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ pending: true, pendingActionId: "pa1", classification: "DESTRUCTIVE", message: "Requires human approval in TRACE's dashboard." }),
      });
      const client = await connectedClient();

      const result = await client.callTool({ name: "trace_perform_action", arguments: { environmentId: "env1", deviceId: "d1", action: "stop", confirm: true } });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.pending).toBe(true);
      expect(parsed.pendingActionId).toBe("pa1");
      // The call reached the real endpoint — it's the backend, not this
      // MCP server, that refused to execute it; confirming the request
      // actually went to the actions endpoint (not silently no-op'd).
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/infra/environments/env1/devices/d1/actions", expect.objectContaining({ method: "POST" }));
    });

    it("trace_execute_command never executes directly either", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ pending: true, pendingActionId: "pa2", classification: "ADMINISTRATIVE", message: "Requires human approval." }),
      });
      const client = await connectedClient();

      const result = await client.callTool({ name: "trace_execute_command", arguments: { environmentId: "env1", deviceName: "beelink", command: "reboot" } });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text).pending).toBe(true);
    });

    it("trace_get_pending_action_status reads status without ever approving anything", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "pa1", status: "APPROVED", resultJson: { success: true } }) });
      const client = await connectedClient();

      const result = await client.callTool({ name: "trace_get_pending_action_status", arguments: { environmentId: "env1", pendingActionId: "pa1" } });

      expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/infra/environments/env1/ai/pending-actions/pa1", expect.anything());
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text).status).toBe("APPROVED");
    });
  });

  describe("TRACE v0.4 — new read-only tools reuse existing data, no separate backend logic", () => {
    it("trace_list_unenrolled_devices filters the existing device list client-side", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { id: "d1", name: "new-switch", enrollmentStatus: "DISCOVERED", onlineState: "UNKNOWN", lastContactAt: null, parentDevice: null },
          { id: "d2", name: "beelink", enrollmentStatus: "ENROLLED", onlineState: "ONLINE", lastContactAt: null, parentDevice: null },
        ],
      });
      const client = await connectedClient();

      const result = await client.callTool({ name: "trace_list_unenrolled_devices", arguments: { environmentId: "env1" } });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text) as Array<{ id: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("d1");
    });

    it("trace_get_vm_inventory filters by parentDevice id, matching the native assistant's own get_vm_inventory tool", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { id: "vm1", name: "vm1", enrollmentStatus: "ENROLLED", onlineState: "ONLINE", lastContactAt: null, parentDevice: { id: "hv1", name: "beelink" } },
          { id: "vm2", name: "vm2", enrollmentStatus: "ENROLLED", onlineState: "ONLINE", lastContactAt: null, parentDevice: { id: "hv2", name: "other" } },
        ],
      });
      const client = await connectedClient();

      const result = await client.callTool({ name: "trace_get_vm_inventory", arguments: { environmentId: "env1", hypervisorDeviceId: "hv1" } });

      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text) as Array<{ id: string }>;
      expect(parsed).toEqual([expect.objectContaining({ id: "vm1" })]);
    });

    it("trace_list_alerts honestly reports no alerting engine instead of fabricating alerts", async () => {
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () =>
            url.includes("/devices")
              ? [{ id: "d1", name: "router", enrollmentStatus: "ENROLLED", onlineState: "OFFLINE", lastContactAt: null, parentDevice: null }]
              : [],
        }),
      );
      const client = await connectedClient();

      const result = await client.callTool({ name: "trace_list_alerts", arguments: { environmentId: "env1" } });

      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(parsed.alertingImplemented).toBe(false);
      expect(parsed.devicesCurrentlyOffline).toEqual([{ id: "d1", name: "router", lastContactAt: null }]);
    });
  });
});
