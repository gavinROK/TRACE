import { IsIn, IsNumberString, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Submitted by an authorized org member after completing GitHub's own App
 * installation flow (clicking "Install" on GitHub and being redirected
 * back). TRACE does not implement that redirect/callback UI yet — this
 * endpoint is the data-model half of "connect an installation you have
 * permission to access"; see docs/DEVELOPMENT_STATUS.md upcoming work.
 */
export class ConnectInstallationDto {
  // GitHub installation ids are small int64s in practice; capping the
  // string length prevents a trivially cheap request from forcing an
  // expensive BigInt conversion of an arbitrarily long digit string.
  @IsNumberString()
  @MaxLength(20)
  installationId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  accountLogin!: string;

  @IsIn(["User", "Organization"])
  accountType!: "User" | "Organization";
}
