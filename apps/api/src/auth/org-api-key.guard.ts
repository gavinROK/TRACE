import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { hashApiKey } from "./hash-api-key";

export interface AuthenticatedRequest extends Request {
  organizationId: string;
}

/**
 * Development-only authorization mechanism, standing in for a real
 * auth/session system (see docs/DEVELOPMENT_STATUS.md "Known
 * limitations"). Resolves the calling organization strictly from a bearer
 * API key — callers can never pass an organization id and have it trusted,
 * which is what prevents one organization's key from ever being used to
 * read another organization's data.
 */
@Injectable()
export class OrgApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawKey = extractBearerToken(request.headers.authorization);

    if (!rawKey) {
      throw new UnauthorizedException("Missing API key");
    }

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { hashedKey: hashApiKey(rawKey) },
      select: { organizationId: true },
    });

    if (!apiKey) {
      throw new UnauthorizedException("Invalid API key");
    }

    request.organizationId = apiKey.organizationId;
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}
