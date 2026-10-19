import { IsBoolean, IsISO8601, IsIn, IsOptional, IsString, MinLength } from "class-validator";

const DEVICE_TYPES = [
  "LAPTOP",
  "DESKTOP",
  "MOBILE",
  "SERVER",
  "SWITCH",
  "ROUTER",
  "ACCESS_POINT",
  "VIRTUAL_MACHINE",
  "OTHER",
] as const;

/**
 * Manual enrollment only — this DTO has no `enrollmentType` field, so a
 * caller can never claim to be "simulated" or "agent" data through the
 * API. The service always records these as MANUAL.
 */
export class EnrollDeviceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(DEVICE_TYPES)
  deviceType!: (typeof DEVICE_TYPES)[number];

  @IsString()
  @MinLength(1)
  operatingSystem!: string;

  @IsString()
  @MinLength(1)
  osVersion!: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  /** Must belong to the caller's own organization — validated in the service. */
  @IsOptional()
  @IsString()
  ownerId?: string;

  /** Must belong to the caller's own organization — validated in the service.
   * Independent of `ownerId` — a device may have either, both, or neither. */
  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  diskEncrypted?: boolean;

  @IsOptional()
  @IsBoolean()
  firewallEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  osUpToDate?: boolean;

  @IsOptional()
  @IsBoolean()
  screenLockEnabled?: boolean;

  /** Self-reported — e.g. "I physically checked this device on this date." */
  @IsOptional()
  @IsISO8601()
  lastCheckInAt?: string;
}
