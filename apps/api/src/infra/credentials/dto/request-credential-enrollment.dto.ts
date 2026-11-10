import { InfraManagementProtocol } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

/** What an external MCP client (Claude) may propose — protocol and an
 * optional display label only. There is deliberately no `payload`
 * field here: the secret itself never travels through this DTO, the
 * resulting AiPendingAction, or any MCP tool call — see
 * credential-enrollment.controller.ts. */
export class RequestCredentialEnrollmentDto {
  @IsEnum(InfraManagementProtocol)
  protocol!: InfraManagementProtocol;

  @IsOptional()
  @IsString()
  label?: string;
}
