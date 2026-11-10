import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { WebauthnService } from "./webauthn.service";

/**
 * @simplewebauthn/server itself is mocked — this verifies TRACE's own
 * glue (challenge bookkeeping, mapping a credential id back to its
 * owning user, persisting the updated counter), not the library's
 * cryptographic verification. There is no automated or manual test of
 * this code against a real browser + YubiKey in this environment.
 */
jest.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: jest.fn(async () => ({ challenge: "reg-challenge-1" })),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(async () => ({ challenge: "auth-challenge-1" })),
  verifyAuthenticationResponse: jest.fn(),
}));

import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

describe("WebauthnService", () => {
  const prisma = {
    traceUser: { findUnique: jest.fn() },
    webauthnCredential: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  };
  let service: WebauthnService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebauthnService(prisma as never);
  });

  it("generates registration options and remembers the challenge for that user", async () => {
    prisma.traceUser.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com", webauthnCredentials: [] });

    const options = await service.generateRegistrationOptionsForUser("u1");

    expect(options.challenge).toBe("reg-challenge-1");
  });

  it("throws if no registration is in progress for the user", async () => {
    await expect(
      service.verifyRegistration("u1", {} as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("stores a new credential after a verified registration", async () => {
    prisma.traceUser.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com", webauthnCredentials: [] });
    await service.generateRegistrationOptionsForUser("u1");
    (verifyRegistrationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "cred-1", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["usb"] },
      },
    });

    await service.verifyRegistration("u1", {} as never, "My YubiKey");

    expect(prisma.webauthnCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "u1", credentialId: "cred-1", deviceLabel: "My YubiKey" }),
    });
  });

  it("rejects when the library reports verification failed", async () => {
    prisma.traceUser.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com", webauthnCredentials: [] });
    await service.generateRegistrationOptionsForUser("u1");
    (verifyRegistrationResponse as jest.Mock).mockResolvedValue({ verified: false });

    await expect(service.verifyRegistration("u1", {} as never)).rejects.toThrow(UnauthorizedException);
    expect(prisma.webauthnCredential.create).not.toHaveBeenCalled();
  });

  it("throws NotFoundException for an email with no registered credentials", async () => {
    prisma.traceUser.findUnique.mockResolvedValue({ id: "u1", webauthnCredentials: [] });

    await expect(service.generateAuthenticationOptionsForEmail("a@b.com")).rejects.toThrow(NotFoundException);
  });

  it("verifies an authentication response and bumps the stored counter", async () => {
    prisma.traceUser.findUnique.mockResolvedValue({
      id: "u1",
      webauthnCredentials: [{ credentialId: "cred-1", transports: ["usb"] }],
    });
    await service.generateAuthenticationOptionsForEmail("a@b.com");

    prisma.webauthnCredential.findUnique.mockResolvedValue({
      id: "wc1",
      userId: "u1",
      credentialId: "cred-1",
      publicKey: Buffer.from([1, 2, 3]).toString("base64"),
      transports: ["usb"],
    });
    (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 7 },
    });

    const userId = await service.verifyAuthentication({ id: "cred-1" } as never);

    expect(userId).toBe("u1");
    expect(prisma.webauthnCredential.update).toHaveBeenCalledWith({
      where: { id: "wc1" },
      data: { counter: 7 },
    });
  });

  it("rejects an authentication response for an unrecognized credential", async () => {
    prisma.webauthnCredential.findUnique.mockResolvedValue(null);

    await expect(service.verifyAuthentication({ id: "unknown-cred" } as never)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
