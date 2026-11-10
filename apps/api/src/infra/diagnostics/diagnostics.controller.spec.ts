import { DiagnosticsController } from "./diagnostics.controller";

function fakeReq(actor: string) {
  return { actor } as never;
}

describe("DiagnosticsController", () => {
  const diagnostics = { run: jest.fn(), listSupported: jest.fn() };
  const controller = new DiagnosticsController(diagnostics as never);

  beforeEach(() => jest.clearAllMocks());

  it("runs immediately for the MCP actor — no approval branch, matching check-health", async () => {
    diagnostics.run.mockResolvedValue({ name: "os_info", output: "Ubuntu" });

    const result = await controller.run(fakeReq("claude-mcp"), "env1", "d1", { name: "os_info" } as never);

    expect(diagnostics.run).toHaveBeenCalledWith("env1", "d1", "claude-mcp", "os_info", undefined);
    expect(result).toEqual({ name: "os_info", output: "Ubuntu" });
  });

  it("runs immediately for a browser session too", async () => {
    diagnostics.run.mockResolvedValue({ name: "security_posture", findings: [] });

    await controller.run(fakeReq("user:u1"), "env1", "d1", { name: "security_posture" } as never);

    expect(diagnostics.run).toHaveBeenCalledWith("env1", "d1", "user:u1", "security_posture", undefined);
  });

  it("lists supported diagnostics for a device", async () => {
    diagnostics.listSupported.mockResolvedValue(["os_info"]);

    const result = await controller.listSupported("env1", "d1");

    expect(diagnostics.listSupported).toHaveBeenCalledWith("env1", "d1");
    expect(result).toEqual(["os_info"]);
  });
});
