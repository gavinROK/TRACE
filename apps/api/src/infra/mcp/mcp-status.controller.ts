import { Controller, ForbiddenException, Get, Req, UseGuards } from "@nestjs/common";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { isMcpActor } from "../auth/mcp-actor";

export interface McpStatus {
  /** Whether TRACE_MCP_SERVICE_TOKEN is set in this server's
   * environment — never the token's value itself. The Settings page
   * uses this to show "configured"/"not configured" without TRACE's
   * own security model (no endpoint ever returns a secret) having to
   * make an exception for its own setup token. */
  serviceTokenConfigured: boolean;
  /** Mirrors TRACE_MCP_READ_ONLY — when true, the MCP service token is
   * restricted to GET/HEAD/OPTIONS by TraceAccessGuard, regardless of
   * what any individual tool call requests. */
  readOnly: boolean;
}

/**
 * Read-only status for the Settings page's MCP configuration panel —
 * see packages/mcp-server/README.md for the actual setup steps (both
 * the service token and TRACE_MCP_READ_ONLY are `.env` values, set
 * outside the running app; there is deliberately no "generate/rotate
 * from the browser" flow here, since that would mean either returning
 * the token to the browser once or storing it somewhere other than the
 * environment this guard already trusts).
 */
@UseGuards(TraceAccessGuard)
@Controller("infra/mcp")
export class McpStatusController {
  @Get("status")
  getStatus(@Req() req: InfraAuthenticatedRequest): McpStatus {
    if (isMcpActor(req.actor)) {
      throw new ForbiddenException("This status check is for the browser Settings page, not for the MCP client itself.");
    }
    return {
      serviceTokenConfigured: Boolean(process.env.TRACE_MCP_SERVICE_TOKEN),
      readOnly: process.env.TRACE_MCP_READ_ONLY === "true",
    };
  }
}
