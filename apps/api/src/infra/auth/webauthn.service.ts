import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * YubiKey / WebAuthn support (PRODUCT_SPEC.md section 12). Registration
 * and assertion challenges are kept in memory, keyed by user id — a
 * restart invalidates any ceremony in flight, which is an acceptable
 * limitation for a single-operator local app (see docs/ARCHITECTURE.md
 * "known limitations"); it never affects already-registered
 * credentials, only a ceremony that was interrupted mid-flight.
 *
 * This code is unit-tested against @simplewebauthn/server's verification
 * functions (mocked — see webauthn.service.spec.ts); it has not been
 * exercised against a real browser + hardware security key in this
 * environment. See README.md "Security model" for what that means for
 * YubiKey support specifically.
 */
@Injectable()
export class WebauthnService {
  private readonly registrationChallenges = new Map<string, string>();
  private readonly authenticationChallenges = new Map<string, string>();

  private get rpID(): string {
    return process.env.TRACE_WEBAUTHN_RP_ID ?? "localhost";
  }
  private get rpName(): string {
    return process.env.TRACE_WEBAUTHN_RP_NAME ?? "TRACE";
  }
  private get origin(): string {
    return process.env.TRACE_WEBAUTHN_ORIGIN ?? "http://localhost:3000";
  }

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async generateRegistrationOptionsForUser(userId: string) {
    const user = await this.prisma.traceUser.findUnique({
      where: { id: userId },
      include: { webauthnCredentials: true },
    });
    if (!user) throw new NotFoundException("User not found");

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: user.email,
      attestationType: "none",
      excludeCredentials: user.webauthnCredentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });

    this.registrationChallenges.set(userId, options.challenge);
    return options;
  }

  async verifyRegistration(userId: string, response: RegistrationResponseJSON, deviceLabel?: string) {
    const expectedChallenge = this.registrationChallenges.get(userId);
    if (!expectedChallenge) {
      throw new UnauthorizedException("No registration in progress for this user (or the server restarted)");
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
    });
    this.registrationChallenges.delete(userId);

    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException("WebAuthn registration could not be verified");
    }

    const { credential } = verification.registrationInfo;
    await this.prisma.webauthnCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64"),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceLabel,
      },
    });
    return { registered: true };
  }

  async generateAuthenticationOptionsForEmail(email: string) {
    const user = await this.prisma.traceUser.findUnique({
      where: { email },
      include: { webauthnCredentials: true },
    });
    if (!user || user.webauthnCredentials.length === 0) {
      throw new NotFoundException("No WebAuthn credentials registered for this account");
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: user.webauthnCredentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      userVerification: "preferred",
    });

    this.authenticationChallenges.set(user.id, options.challenge);
    return options;
  }

  async verifyAuthentication(response: AuthenticationResponseJSON): Promise<string> {
    const stored = await this.prisma.webauthnCredential.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException("Unrecognized credential");
    }

    const expectedChallenge = this.authenticationChallenges.get(stored.userId);
    if (!expectedChallenge) {
      throw new UnauthorizedException("No authentication in progress for this user (or the server restarted)");
    }

    const credential: WebAuthnCredential = {
      id: stored.credentialId,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64")),
      counter: Number(stored.counter),
      transports: stored.transports as WebAuthnCredential["transports"],
    };

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      credential,
    });
    this.authenticationChallenges.delete(stored.userId);

    if (!verification.verified) {
      throw new UnauthorizedException("WebAuthn authentication could not be verified");
    }

    await this.prisma.webauthnCredential.update({
      where: { id: stored.id },
      data: { counter: verification.authenticationInfo.newCounter },
    });

    return stored.userId;
  }
}
