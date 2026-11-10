import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { EmailOnlyDto, EmailPasswordDto } from "./dto/credentials.dto";
import { parseCookieHeader } from "./cookie.util";
import { InfraAuthenticatedRequest, SESSION_COOKIE_NAME, TraceAccessGuard } from "./trace-access.guard";
import { TraceAuthService } from "./trace-auth.service";
import { WebauthnService } from "./webauthn.service";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

@Controller("infra/auth")
export class TraceAuthController {
  constructor(
    private readonly authService: TraceAuthService,
    private readonly webauthnService: WebauthnService,
  ) {}

  @Get("status")
  async status() {
    return { needsSetup: !(await this.authService.hasAnyUser()) };
  }

  @Post("setup")
  async setup(@Body() dto: EmailPasswordDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.bootstrap(dto.email, dto.password);
    const session = await this.authService.issueSession(user.id);
    this.setSessionCookie(res, session.token, session.expiresAt);
    return { email: user.email };
  }

  @Post("login")
  async login(@Body() dto: EmailPasswordDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.authService.login(dto.email, dto.password);
    this.setSessionCookie(res, session.token, session.expiresAt);
    return { ok: true };
  }

  @Post("logout")
  async logout(@Req() req: InfraAuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME];
    if (token) await this.authService.revokeSession(token);
    res.clearCookie(SESSION_COOKIE_NAME, COOKIE_OPTIONS);
    return { ok: true };
  }

  @UseGuards(TraceAccessGuard)
  @Get("me")
  me(@Req() req: InfraAuthenticatedRequest) {
    return { actor: req.actor };
  }

  @UseGuards(TraceAccessGuard)
  @Post("webauthn/registration-options")
  async registrationOptions(@Req() req: InfraAuthenticatedRequest) {
    const userId = this.requireUserId(req);
    return this.webauthnService.generateRegistrationOptionsForUser(userId);
  }

  @UseGuards(TraceAccessGuard)
  @Post("webauthn/registration-verify")
  async registrationVerify(
    @Req() req: InfraAuthenticatedRequest,
    @Body() body: { response: RegistrationResponseJSON; deviceLabel?: string },
  ) {
    const userId = this.requireUserId(req);
    return this.webauthnService.verifyRegistration(userId, body.response, body.deviceLabel);
  }

  @Post("webauthn/authentication-options")
  async authenticationOptions(@Body() dto: EmailOnlyDto) {
    return this.webauthnService.generateAuthenticationOptionsForEmail(dto.email);
  }

  @Post("webauthn/authentication-verify")
  async authenticationVerify(
    @Body() body: { response: AuthenticationResponseJSON },
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.webauthnService.verifyAuthentication(body.response);
    const session = await this.authService.issueSession(userId);
    this.setSessionCookie(res, session.token, session.expiresAt);
    return { ok: true };
  }

  private requireUserId(req: InfraAuthenticatedRequest): string {
    if (!req.actor.startsWith("user:")) {
      throw new Error("WebAuthn registration requires a browser session, not a service token");
    }
    return req.actor.slice("user:".length);
  }

  private setSessionCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(SESSION_COOKIE_NAME, token, { ...COOKIE_OPTIONS, expires: expiresAt });
  }
}
