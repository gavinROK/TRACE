import { InfraDeviceCategory, InfraManagementProtocol } from "@prisma/client";
import { IsArray, IsEnum, IsOptional, IsString, MinLength } from "class-validator";

export class CreateInfraDeviceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(InfraDeviceCategory)
  category!: InfraDeviceCategory;

  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() operatingSystem?: string;
  @IsOptional() @IsString() osVersion?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() parentDeviceId?: string;

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
  @IsEnum(InfraManagementProtocol, { each: true })
  managementProtocols?: InfraManagementProtocol[];
}
