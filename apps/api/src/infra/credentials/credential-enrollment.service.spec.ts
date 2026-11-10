import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { CredentialEnrollmentStatus } from "@prisma/client";
import { CREDENTIAL_ENROLLMENT_WINDOW_MS, CredentialEnrollmentService } from "./credential-enrollment.service";

describe("CredentialEnrollmentService", () => {
  const prisma = {
    infraDevice: { findFirst: jest.fn() },
    credentialEnrollmentSession: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  };
  const auditLog = { record: jest.fn() };
  const credentialsService = { create: jest.fn() };
  const service = new CredentialEnrollmentService(prisma as never, auditLog as never, credentialsService as never);

  const ORIGINAL_ENV = process.env.TRACE_CREDENTIAL_ENROLLMENT_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TRACE_CREDENTIAL_ENROLLMENT_ENABLED;
  });

  afterAll(() => {
    process.env.TRACE_CREDENTIAL_ENROLLMENT_ENABLED = ORIGINAL_ENV;
  });

  function authorizedSession(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "ces1",
      environmentId: "env1",
      deviceId: "d1",
      protocol: "SSH",
      label: "router-ssh",
      status: CredentialEnrollmentStatus.AUTHORIZED,
      requestedBy: "user:u1",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + CREDENTIAL_ENROLLMENT_WINDOW_MS),
      completedAt: null,
      credentialId: null,
      ...overrides,
    };
  }

  describe("isEnabled / authorization gate", () => {
    it("is disabled by default — no env var set", () => {
      expect(service.isEnabled()).toBe(false);
    });

    it("stays disabled for any value other than the exact string \"true\"", () => {
      process.env.TRACE_CREDENTIAL_ENROLLMENT_ENABLED = "1";
      expect(service.isEnabled()).toBe(false);
      process.env.TRACE_CREDENTIAL_ENROLLMENT_ENABLED = "TRUE";
      expect(service.isEnabled()).toBe(false);
    });

    it("is enabled only once explicitly opted in", () => {
      process.env.TRACE_CREDENTIAL_ENROLLMENT_ENABLED = "true";
      expect(service.isEnabled()).toBe(true);
    });

    it("authorizeSession refuses outright when disabled, creating no session row", async () => {
      await expect(service.authorizeSession("env1", "d1", "SSH" as never, "router-ssh", "user:u1")).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.credentialEnrollmentSession.create).not.toHaveBeenCalled();
    });
  });

  describe("authorizeSession", () => {
    beforeEach(() => {
      process.env.TRACE_CREDENTIAL_ENROLLMENT_ENABLED = "true";
    });

    it("rejects a deviceId outside the environment", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue(null);

      await expect(service.authorizeSession("env1", "missing", "SSH" as never, undefined, "user:u1")).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.credentialEnrollmentSession.create).not.toHaveBeenCalled();
    });

    it("supersedes any still-AUTHORIZED session for the same device before creating a new one", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1" });
      prisma.credentialEnrollmentSession.create.mockResolvedValue(authorizedSession());

      await service.authorizeSession("env1", "d1", "SSH" as never, "router-ssh", "user:u1");

      expect(prisma.credentialEnrollmentSession.updateMany).toHaveBeenCalledWith({
        where: { deviceId: "d1", status: CredentialEnrollmentStatus.AUTHORIZED },
        data: { status: CredentialEnrollmentStatus.REVOKED },
      });
    });

    it("opens exactly a 5-minute window and records who authorized it", async () => {
      prisma.infraDevice.findFirst.mockResolvedValue({ id: "d1" });
      prisma.credentialEnrollmentSession.create.mockResolvedValue(authorizedSession());
      const before = Date.now();

      await service.authorizeSession("env1", "d1", "SSH" as never, "router-ssh", "user:u1");

      const data = prisma.credentialEnrollmentSession.create.mock.calls[0][0].data;
      expect(data.requestedBy).toBe("user:u1");
      expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + CREDENTIAL_ENROLLMENT_WINDOW_MS - 1000);
      expect(data.expiresAt.getTime()).toBeLessThanOrEqual(before + CREDENTIAL_ENROLLMENT_WINDOW_MS + 1000);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "credential-enrollment.authorized", actor: "user:u1" }),
      );
    });
  });

  describe("complete — replay prevention, expiration, failure handling", () => {
    it("throws NotFoundException for a session outside the environment", async () => {
      prisma.credentialEnrollmentSession.findFirst.mockResolvedValue(null);

      await expect(service.complete("env1", "missing", "user:u1", { label: "x", payload: {} })).rejects.toThrow(
        NotFoundException,
      );
      expect(credentialsService.create).not.toHaveBeenCalled();
    });

    it("rejects a session that is already COMPLETED — a session can never be consumed twice", async () => {
      prisma.credentialEnrollmentSession.findFirst.mockResolvedValue(
        authorizedSession({ status: CredentialEnrollmentStatus.COMPLETED }),
      );

      await expect(service.complete("env1", "ces1", "user:u1", { label: "x", payload: {} })).rejects.toThrow(
        BadRequestException,
      );
      expect(credentialsService.create).not.toHaveBeenCalled();
    });

    it("rejects and flips to EXPIRED a session past its expiresAt, even though its stored status is still AUTHORIZED", async () => {
      prisma.credentialEnrollmentSession.findFirst.mockResolvedValue(
        authorizedSession({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.complete("env1", "ces1", "user:u1", { label: "x", payload: {} })).rejects.toThrow(
        /expired/,
      );
      expect(prisma.credentialEnrollmentSession.update).toHaveBeenCalledWith({
        where: { id: "ces1" },
        data: { status: CredentialEnrollmentStatus.EXPIRED },
      });
      expect(credentialsService.create).not.toHaveBeenCalled();
    });

    it("writes the credential through CredentialsService using the session's own protocol/deviceId, never the request body's", async () => {
      prisma.credentialEnrollmentSession.findFirst.mockResolvedValue(authorizedSession());
      credentialsService.create.mockResolvedValue({ id: "cred1", label: "router-ssh", protocol: "SSH" });

      const result = await service.complete("env1", "ces1", "user:u1", {
        label: "router-ssh",
        payload: { username: "admin", password: "Chloe23@@" },
      });

      expect(credentialsService.create).toHaveBeenCalledWith("env1", {
        label: "router-ssh",
        protocol: "SSH",
        deviceId: "d1",
        payload: { username: "admin", password: "Chloe23@@" },
      });
      expect(prisma.credentialEnrollmentSession.update).toHaveBeenCalledWith({
        where: { id: "ces1" },
        data: expect.objectContaining({ status: CredentialEnrollmentStatus.COMPLETED, credentialId: "cred1" }),
      });
      expect(result).toEqual({ id: "cred1", label: "router-ssh", protocol: "SSH" });
    });

    it("never writes the secret payload into the audit log — only metadata", async () => {
      prisma.credentialEnrollmentSession.findFirst.mockResolvedValue(authorizedSession());
      credentialsService.create.mockResolvedValue({ id: "cred1" });

      await service.complete("env1", "ces1", "user:u1", {
        label: "router-ssh",
        payload: { username: "admin", password: "Chloe23@@", privateKey: "-----BEGIN KEY-----" },
      });

      const auditCall = auditLog.record.mock.calls.find(([entry]) => entry.action === "credential-enrollment.completed");
      expect(auditCall).toBeDefined();
      expect(JSON.stringify(auditCall![0])).not.toContain("Chloe23@@");
      expect(JSON.stringify(auditCall![0])).not.toContain("BEGIN KEY");
    });
  });

  describe("cancel", () => {
    it("revokes an AUTHORIZED session at the user's request, at any time", async () => {
      prisma.credentialEnrollmentSession.findFirst.mockResolvedValue(authorizedSession());

      await service.cancel("env1", "ces1", "user:u1");

      expect(prisma.credentialEnrollmentSession.update).toHaveBeenCalledWith({
        where: { id: "ces1" },
        data: { status: CredentialEnrollmentStatus.REVOKED },
      });
    });

    it("refuses to cancel a session that is already terminal", async () => {
      prisma.credentialEnrollmentSession.findFirst.mockResolvedValue(
        authorizedSession({ status: CredentialEnrollmentStatus.COMPLETED }),
      );

      await expect(service.cancel("env1", "ces1", "user:u1")).rejects.toThrow(BadRequestException);
    });
  });

  describe("getActive", () => {
    it("returns null when the device has no session at all", async () => {
      prisma.credentialEnrollmentSession.findFirst.mockResolvedValue(null);

      expect(await service.getActive("env1", "d1")).toBeNull();
    });

    it("reports an AUTHORIZED-but-past-expiry session as EXPIRED without mutating it (read-only)", async () => {
      prisma.credentialEnrollmentSession.findFirst.mockResolvedValue(
        authorizedSession({ expiresAt: new Date(Date.now() - 1000) }),
      );

      const status = await service.getActive("env1", "d1");

      expect(status?.status).toBe(CredentialEnrollmentStatus.EXPIRED);
      expect(status?.secondsRemaining).toBe(0);
      expect(prisma.credentialEnrollmentSession.update).not.toHaveBeenCalled();
    });

    it("never includes a secret — the session row has no field capable of carrying one", async () => {
      prisma.credentialEnrollmentSession.findFirst.mockResolvedValue(authorizedSession());

      const status = await service.getActive("env1", "d1");

      expect(Object.keys(status ?? {})).not.toContain("payload");
      expect(JSON.stringify(status)).not.toMatch(/password|secret|privateKey/i);
    });
  });
});
