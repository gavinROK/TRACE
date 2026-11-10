import { ConflictException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { TraceAuthService } from "./trace-auth.service";

describe("TraceAuthService", () => {
  const prisma = {
    traceUser: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    traceSession: { create: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn() },
  };
  const service = new TraceAuthService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("bootstrap", () => {
    it("refuses to create a second operator account", async () => {
      prisma.traceUser.count.mockResolvedValue(1);

      await expect(service.bootstrap("a@b.com", "password123")).rejects.toThrow(ConflictException);
      expect(prisma.traceUser.create).not.toHaveBeenCalled();
    });

    it("hashes the password before storing it", async () => {
      prisma.traceUser.count.mockResolvedValue(0);
      prisma.traceUser.create.mockImplementation(({ data }) => ({ id: "u1", ...data }));

      await service.bootstrap("a@b.com", "password123");

      const storedHash = prisma.traceUser.create.mock.calls[0][0].data.passwordHash;
      expect(storedHash).not.toBe("password123");
      expect(await bcrypt.compare("password123", storedHash)).toBe(true);
    });
  });

  describe("login", () => {
    it("rejects an unknown email", async () => {
      prisma.traceUser.findUnique.mockResolvedValue(null);

      await expect(service.login("nobody@example.com", "x")).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a wrong password", async () => {
      prisma.traceUser.findUnique.mockResolvedValue({
        id: "u1",
        passwordHash: await bcrypt.hash("correct-password", 10),
      });

      await expect(service.login("a@b.com", "wrong-password")).rejects.toThrow(UnauthorizedException);
    });

    it("issues a session on a correct password", async () => {
      prisma.traceUser.findUnique.mockResolvedValue({
        id: "u1",
        passwordHash: await bcrypt.hash("correct-password", 10),
      });
      prisma.traceSession.create.mockResolvedValue({});

      const session = await service.login("a@b.com", "correct-password");

      expect(session.token).toHaveLength(43); // 32 random bytes, base64url
      expect(prisma.traceSession.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: "u1" }) }),
      );
    });
  });

  describe("validateSessionToken", () => {
    it("returns undefined for an expired session", async () => {
      prisma.traceSession.findUnique.mockResolvedValue({
        expiresAt: new Date(Date.now() - 1000),
        user: { id: "u1" },
      });

      expect(await service.validateSessionToken("token")).toBeUndefined();
    });

    it("returns the user for a still-valid session", async () => {
      prisma.traceSession.findUnique.mockResolvedValue({
        expiresAt: new Date(Date.now() + 1000 * 60),
        user: { id: "u1" },
      });

      expect(await service.validateSessionToken("token")).toEqual({ id: "u1" });
    });

    it("never stores the raw token — only its hash is looked up", async () => {
      prisma.traceSession.findUnique.mockResolvedValue(null);

      await service.validateSessionToken("raw-token-value");

      const where = prisma.traceSession.findUnique.mock.calls[0][0].where;
      expect(where.tokenHash).not.toBe("raw-token-value");
      expect(where.tokenHash).toHaveLength(64); // sha256 hex
    });
  });
});
