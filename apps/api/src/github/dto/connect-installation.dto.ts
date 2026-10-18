import { IsIn, IsNumberString, IsString, MinLength } from "class-validator";

/**
 * Submitted by an authorized org member after completing GitHub's own App
 * installation flow (clicking "Install" on GitHub and being redirected
 * back). TRACE does not implement that redirect/callback UI yet — this
 * endpoint is the data-model half of "connect an installation you have
 * permission to access"; see docs/DEVELOPMENT_STATUS.md upcoming work.
 */
export class ConnectInstallationDto {
  @IsNumberString()
  installationId!: string;

  @IsString()
  @MinLength(1)
  accountLogin!: string;

  @IsIn(["User", "Organization"])
  accountType!: "User" | "Organization";
}
