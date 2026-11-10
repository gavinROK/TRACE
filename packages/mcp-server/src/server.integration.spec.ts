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

  it("lists all registered tools, matching PRODUCT_SPEC.md section 11", async () => {
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
        "trace_get_topology",
        "trace_list_devices",
        "trace_list_environments",
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
});
