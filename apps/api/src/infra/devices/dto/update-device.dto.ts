import { InfraDeviceCategory, InfraManagementProtocol } from "@prisma/client";
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/** A hand-written partial rather than @nestjs/mapped-types' PartialType
 * — that package ships ESM-only in its current release, which this
 * CommonJS-compiled app (and Jest) cannot require (see
 * docs/ARCHITECTURE.md "known limitations"). Every field here must stay
 * in sync with CreateInfraDeviceDto by hand. */
export class UpdateInfraDeviceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(InfraDeviceCategory) category?: InfraDeviceCategory;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() operatingSystem?: string;
  @IsOptional() @IsString() osVersion?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() parentDeviceId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  managementPort?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ipAddresses?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  macAddresses?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(InfraManagementProtocol, { each: true })
  managementProtocols?: InfraManagementProtocol[];
}
