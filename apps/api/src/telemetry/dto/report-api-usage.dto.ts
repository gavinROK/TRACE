import { IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";

/**
 * Mirrors packages/telemetry-sdk's ApiUsageReport shape — keep both in
 * sync by hand; they intentionally don't share a type import since the
 * SDK must stay a standalone, dependency-free package.
 *
 * Deliberately has no field for API keys, prompt text, or response
 * bodies — see packages/telemetry-sdk/src/types.ts for why.
 */
export class ReportApiUsageDto {
  @IsIn(["verified", "inferred", "unknown"])
  actorType!: "verified" | "inferred" | "unknown";

  @IsString()
  @MinLength(1)
  provider!: string;

  @IsString()
  @MinLength(1)
  service!: string;

  @IsOptional()
  @IsString()
  developerId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  requestCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  tokenCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedCostUsd?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  latencyMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  errorCount?: number;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}
