import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from "class-validator";

// Caps a single import to a sane size rather than letting one request
// create an unbounded number of rows — no real org needs more than this
// in one CSV.
const MAX_ITEMS_PER_REQUEST = 500;

export class SoftwareItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @IsISO8601()
  installedAt?: string;
}

/**
 * Backs both manual entry (one item) and CSV import (many) — the client
 * parses the CSV itself and posts the already-structured rows here, so
 * the backend needs no file-upload/multipart handling. `source` is
 * supplied explicitly by the caller rather than inferred from item count,
 * so a one-row CSV import is never mislabeled as manual entry.
 */
export class AddSoftwareDto {
  @IsIn(["MANUAL", "CSV_IMPORT"])
  source!: "MANUAL" | "CSV_IMPORT";

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ITEMS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => SoftwareItemDto)
  items!: SoftwareItemDto[];
}
