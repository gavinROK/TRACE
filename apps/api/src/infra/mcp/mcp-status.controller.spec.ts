import { ForbiddenException } from "@nestjs/common";
import { McpStatusController } from "./mcp-status.controller";

function fakeReq(actor: string) {
  return { actor } as never;
}

describe("McpStatusController", () => {
  const controller = new McpStatusController();
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports not configured and not read-only when neither env var is set", () => {
    delete process.env.TRACE_MCP_SERVICE_TOKEN;
    delete process.env.TRACE_MCP_READ_ONLY;

    expect(controller.getStatus(fakeReq("user:u1"))).toEqual({ serviceTokenConfigured: false, readOnly: false });
  });

  it("reports configured + read-only when both are set, without ever returning the token value", () => {
    process.env.TRACE_MCP_SERVICE_TOKEN = "super-secret-token-value";
    process.env.TRACE_MCP_READ_ONLY = "true";

    const status = controller.getStatus(fakeReq("user:u1"));

    expect(status).toEqual({ serviceTokenConfigured: true, readOnly: true });
    expect(JSON.stringify(status)).not.toContain("super-secret-token-value");
  });

  it("refuses the MCP actor itself — this endpoint is for the browser Settings page", () => {
    process.env.TRACE_MCP_SERVICE_TOKEN = "token";
    expect(() => controller.getStatus(fakeReq("claude-mcp"))).toThrow(ForbiddenException);
  });
});
