import { IsBoolean, IsObject, IsOptional, IsString, MinLength } from "class-validator";

export class PerformActionDto {
  @IsString()
  @MinLength(1)
  action!: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  /** Required (and must be true) for a destructive action — see
   * DESTRUCTIVE_ACTIONS in actions.service.ts. */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
