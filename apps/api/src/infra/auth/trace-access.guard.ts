import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { parseCookieHeader } from "./cookie.util";
import { TraceAuthService } from "./trace-auth.service";

export const SESSION_COOKIE_NAME = "trace_session";

export interface InfraAuthenticatedRequest extends Request {
  /** "user:<TraceUser id>" for a browser session, or "claude-mcp" for
   * the MCP bridge's service token — every audit log entry and command
   * run records this, so it is always someone, never blank. */
  actor: string;
}

/**
 * Every /infra route goes through this guard. It accepts either:
 *  - a valid trace_session cookie (the browser UI), or
 *  - `Authorization: Bearer <TRACE_MCP_SERVICE_TOKEN>` (the MCP bridge —
 *    see packages/mcp-server). The service token is a fixed shared
 *    secret read from the server's own environment, intended only for
 *    the MCP server running on the same machine; it is never sent to,
 *    or readable by, Claude itself (see docs/ARCHITECTURE.md).
 *
 * There is deliberately no third "trust whatever the caller claims"
 * path — an unauthenticated request is always rejected.
 */
@Injectable()
export class TraceAccessGuard implements CanActivate {
  constructor(private readonly authService: TraceAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<InfraAuthenticatedRequest>();

    const bearer = extractBearerToken(request.headers.authorization);
    const serviceToken = process.env.TRACE_MCP_SERVICE_TOKEN;
    if (bearer && serviceToken && bearer === serviceToken) {
      request.actor = "claude-mcp";
      return true;
    }

    const cookies = parseCookieHeader(request.headers.cookie);
    const sessionToken = cookies[SESSION_COOKIE_NAME];
    if (sessionToken) {
      const user = await this.authService.validateSessionToken(sessionToken);
      if (user) {
        request.actor = `user:${user.id}`;
        return true;
      }
    }

    throw new UnauthorizedException("Not authenticated");
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" ? token : undefined;
}
