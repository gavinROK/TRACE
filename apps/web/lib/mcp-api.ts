import { InfraApiError } from "./infra-api";
import type { McpStatus } from "./mcp-types";

const BASE_URL = process.env.NEXT_PUBLIC_TRACE_API_BASE_URL ?? "http://localhost:4000";

export const mcpApi = {
  /** Never returns the service token itself — only whether one is set
   * and whether read-only mode is on. See mcp-status.controller.ts. */
  async getStatus(): Promise<McpStatus> {
    const res = await fetch(`${BASE_URL}/infra/mcp/status`, { credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new InfraApiError(res.status, body.message ?? res.statusText);
    }
    return res.json() as Promise<McpStatus>;
  },
};
