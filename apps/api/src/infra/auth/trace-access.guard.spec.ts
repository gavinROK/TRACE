import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "./trace-access.guard";

function createContext(headers: Record<string, string | undefined>) {
  const request = { headers } as InfraAuthenticatedRequest;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("TraceAccessGuard", () => {
  const authService = { validateSessionToken: jest.fn() };
  const guard = new TraceAccessGuard(authService as never);
  const originalServiceToken = process.env.TRACE_MCP_SERVICE_TOKEN;

  beforeEach(() => {
    authService.validateSessionToken.mockReset();
    process.env.TRACE_MCP_SERVICE_TOKEN = "mcp-secret-token";
  });

  afterAll(() => {
    process.env.TRACE_MCP_SERVICE_TOKEN = originalServiceToken;
  });

  it("rejects a request with no cookie and no bearer token", async () => {
    await expect(guard.canActivate(createContext({}))).rejects.toThrow(UnauthorizedException);
  });

  it("accepts the configured MCP service token and tags the actor as claude-mcp", async () => {
    const context = createContext({ authorization: "Bearer mcp-secret-token" });

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(context.switchToHttp().getRequest<InfraAuthenticatedRequest>().actor).toBe("claude-mcp");
    expect(authService.validateSessionToken).not.toHaveBeenCalled();
  });

  it("rejects a bearer token that does not match the configured service token", async () => {
    await expect(
      guard.canActivate(createContext({ authorization: "Bearer wrong-token" })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("accepts a valid session cookie and tags the actor with the user id", async () => {
    authService.validateSessionToken.mockResolvedValue({ id: "user_1" });
    const context = createContext({ cookie: "trace_session=abc123; other=1" });

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(authService.validateSessionToken).toHaveBeenCalledWith("abc123");
    expect(context.switchToHttp().getRequest<InfraAuthenticatedRequest>().actor).toBe("user:user_1");
  });

  it("rejects an expired or unknown session token", async () => {
    authService.validateSessionToken.mockResolvedValue(undefined);

    await expect(
      guard.canActivate(createContext({ cookie: "trace_session=expired" })),
    ).rejects.toThrow(UnauthorizedException);
  });
});
