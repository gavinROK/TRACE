import { InfraDeviceCategory } from "@prisma/client";
import { IsEnum, IsOptional, IsString, Matches, MinLength } from "class-validator";

export class ImportCandidateDto {
  @IsString()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}$/)
  ip!: string;

  @IsOptional()
  @IsString()
  mac?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(InfraDeviceCategory)
  category!: InfraDeviceCategory;

  @IsOptional()
  @IsString()
  vendorGuess?: string;
}
