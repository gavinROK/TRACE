import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { hashApiKey } from "./hash-api-key";
import { AuthenticatedRequest, OrgApiKeyGuard } from "./org-api-key.guard";

function createContext(authorization?: string) {
  const request = { headers: { authorization } } as AuthenticatedRequest;
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe("OrgApiKeyGuard", () => {
  const prisma = { apiKey: { findUnique: jest.fn() } };
  const guard = new OrgApiKeyGuard(prisma as never);

  beforeEach(() => {
    prisma.apiKey.findUnique.mockReset();
  });

  it("rejects a request with no Authorization header", async () => {
    await expect(guard.canActivate(createContext(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer Authorization header", async () => {
    await expect(guard.canActivate(createContext("Basic abc123"))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a key that doesn't match any stored hash", async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(createContext("Bearer not-a-real-key"))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
      where: { hashedKey: hashApiKey("not-a-real-key") },
      select: { organizationId: true },
    });
  });

  it("attaches organizationId from the resolved key and allows the request through", async () => {
    prisma.apiKey.findUnique.mockResolvedValue({ organizationId: "org_123" });
    const context = createContext("Bearer a-real-key");

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    expect(request.organizationId).toBe("org_123");
  });

  it("never trusts a client-supplied organization id — only the key determines it", async () => {
    // Even if a caller stuffs an organizationId onto the request object
    // themselves, canActivate must overwrite it from the resolved key, not
    // read or preserve whatever was already there.
    prisma.apiKey.findUnique.mockResolvedValue({ organizationId: "org_real_owner" });
    const request = {
      headers: { authorization: "Bearer a-real-key" },
      organizationId: "org_attacker_supplied",
    } as AuthenticatedRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await guard.canActivate(context);

    expect(request.organizationId).toBe("org_real_owner");
  });
});
