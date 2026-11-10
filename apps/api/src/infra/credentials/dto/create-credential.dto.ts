import { InfraManagementProtocol } from "@prisma/client";
import { IsEnum, IsObject, IsOptional, IsString, MinLength } from "class-validator";

export class CreateCredentialDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsEnum(InfraManagementProtocol)
  protocol!: InfraManagementProtocol;

  @IsOptional()
  @IsString()
  deviceId?: string;

  /** Protocol-specific secret payload (SSH username/password/key,
   * Proxmox API token, SNMPv3 auth/priv keys, ...). Encrypted
   * immediately on write; never echoed back by any endpoint. */
  @IsObject()
  payload!: Record<string, unknown>;
}
