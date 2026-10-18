import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedRequest } from "./org-api-key.guard";

/**
 * Reads the organization id that OrgApiKeyGuard resolved from the caller's
 * API key. Only usable on routes guarded by OrgApiKeyGuard.
 */
export const CurrentOrganizationId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.organizationId;
  },
);
