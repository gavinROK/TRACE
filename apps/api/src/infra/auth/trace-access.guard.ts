import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { parseCookieHeader } from "./cookie.util";
import { TraceAuthService } from "./trace-auth.service";

export const SESSION_COOKIE_NAME = "trace_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
 *
 * `TRACE_MCP_READ_ONLY=true` additionally restricts the service token
 * (never a browser session) to safe HTTP methods only — meant for
 * initial setup/testing, so the first time you wire up the MCP server
 * it genuinely can't execute a command or change anything, only read.
 * Unset it (or set it to anything else) once you're ready to let Claude
 * run commands/actions through TRACE.
 */
@Injectable()
export class TraceAccessGuard implements CanActivate {
  constructor(private readonly authService: TraceAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<InfraAuthenticatedRequest>();

    const bearer = extractBearerToken(request.headers.authorization);
    const serviceToken = process.env.TRACE_MCP_SERVICE_TOKEN;
    if (bearer && serviceToken && bearer === serviceToken) {
      if (process.env.TRACE_MCP_READ_ONLY === "true" && !SAFE_METHODS.has(request.method)) {
        throw new ForbiddenException(
          `TRACE_MCP_READ_ONLY is enabled — the MCP service token cannot make a ${request.method} request right now. Unset TRACE_MCP_READ_ONLY in apps/api/.env once you want Claude to execute commands/actions through TRACE.`,
        );
      }
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
