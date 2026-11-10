import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class ExecCommandDto {
  @IsString()
  @MinLength(1)
  deviceName!: string;

  @IsString()
  @MinLength(1)
  command!: string;

  @IsOptional()
  @IsInt()
  @Min(1_000)
  @Max(300_000)
  timeoutMs?: number;
}

export class ExecGroupCommandDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  deviceNames!: string[];

  @IsString()
  @MinLength(1)
  command!: string;

  @IsOptional()
  @IsInt()
  @Min(1_000)
  @Max(300_000)
  timeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(16)
  concurrency?: number;

  /** Required (and must be true) once deviceNames has more than one
   * entry — PRODUCT_SPEC.md section 12: broad multi-device changes need
   * explicit authorization, not just a valid session. */
  @IsOptional()
  confirm?: boolean;
}
