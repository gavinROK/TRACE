import { IsOptional, IsString, Matches, MinLength } from "class-validator";

export class CreateEnvironmentDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: "slug must be lowercase letters, numbers, and hyphens only" })
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
