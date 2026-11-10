import { IsObject, IsString, MinLength } from "class-validator";

/** Submitted only by a real browser session (TraceAccessGuard never
 * assigns the MCP actor from a session cookie) directly from TRACE's
 * own UI — see credential-enrollment.controller.ts `complete`. Protocol
 * and deviceId are intentionally absent: both come from the
 * CredentialEnrollmentSession a human already authorized, not from
 * this request body, so completing a session can never attach a
 * credential to a different device or protocol than what was
 * approved. */
export class CompleteCredentialEnrollmentDto {
  @IsString()
  @MinLength(1)
  label!: string;

  /** Protocol-specific secret payload — same shape CreateCredentialDto
   * takes (SSH username/password/key, Proxmox API token, SNMPv3 auth/
   * priv keys, ...). Encrypted immediately via CredentialsService.create;
   * never echoed back. */
  @IsObject()
  payload!: Record<string, unknown>;
}
