import { createHash, randomBytes } from "node:crypto";
import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const BCRYPT_ROUNDS = 12;

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/**
 * The single TRACE operator account (TraceUser — see PRODUCT_SPEC.md
 * section 14, single-user v1). Sessions are opaque random tokens; only
 * their sha256 hash is ever persisted, matching ApiKey.hashedKey's
 * pattern in the developer-intelligence module.
 */
@Injectable()
export class TraceAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async hasAnyUser(): Promise<boolean> {
    const count = await this.prisma.traceUser.count();
    return count > 0;
  }

  /** Creates the one TRACE operator account. Only callable while no
   * account exists yet — this is first-run setup, not an admin-creation
   * endpoint, and it cannot be used to add a second user later. */
  async bootstrap(email: string, password: string) {
    if (await this.hasAnyUser()) {
      throw new ConflictException("TRACE already has an operator account — use /auth/login instead.");
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return this.prisma.traceUser.create({ data: { email, passwordHash } });
  }

  async login(email: string, password: string): Promise<IssuedSession> {
    const user = await this.prisma.traceUser.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return this.issueSession(user.id);
  }

  async issueSession(userId: string): Promise<IssuedSession> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.traceSession.create({
      data: { userId, tokenHash: this.hashToken(token), expiresAt },
    });
    return { token, expiresAt };
  }

  async validateSessionToken(token: string) {
    const session = await this.prisma.traceSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) {
      return undefined;
    }
    return session.user;
  }

  async revokeSession(token: string): Promise<void> {
    await this.prisma.traceSession.deleteMany({ where: { tokenHash: this.hashToken(token) } });
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
