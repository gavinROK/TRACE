/**
 * The one actor string TraceAccessGuard ever assigns to a request
 * authenticated via TRACE_MCP_SERVICE_TOKEN (never to a session-cookie
 * request) — see trace-access.guard.ts. Centralized here instead of
 * repeating the literal so every place that needs to tell "an external
 * MCP client" apart from "a real browser session" (approvals.service.ts,
 * ai.controller.ts, console.controller.ts, actions.controller.ts) does
 * the same check the same way.
 */
export const MCP_ACTOR = "claude-mcp";

export function isMcpActor(actor: string): boolean {
  return actor === MCP_ACTOR;
}
