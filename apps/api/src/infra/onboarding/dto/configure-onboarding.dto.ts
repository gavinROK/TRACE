import { InfraDeviceCategory } from "@prisma/client";
import { IsEnum, IsOptional, IsString, Matches } from "class-validator";

export class ConfigureOnboardingDto {
  @IsString()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}$/)
  ip!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(InfraDeviceCategory)
  category?: InfraDeviceCategory;
}
