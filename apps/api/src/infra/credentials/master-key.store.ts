import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { Injectable, Logger } from "@nestjs/common";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "TRACE";
const KEYCHAIN_ACCOUNT = "trace-master-key";

/**
 * Loads (or creates, on first run) the single symmetric key that
 * encrypts every InfraCredential row. Per PRODUCT_SPEC.md section 12
 * ("Prefer macOS Keychain integration"), the key itself lives in the
 * macOS login Keychain via the `security` CLI — never in the Postgres
 * database, and never written to a file this repo could accidentally
 * commit. `security` is invoked with execFile and a fixed argument
 * array (never a shell string), so nothing here is vulnerable to
 * argument/shell injection.
 *
 * TRACE_MASTER_KEY (base64, 32 bytes) is accepted as an explicit
 * override for CI and non-macOS deployments, where there is no
 * Keychain to use — this is documented in README.md as less secure
 * than Keychain storage and intended for test/CI, not a real homelab
 * deployment.
 */
@Injectable()
export class MasterKeyStore {
  private readonly logger = new Logger(MasterKeyStore.name);
  private cachedKey: Buffer | undefined;

  async getKey(): Promise<Buffer> {
    if (this.cachedKey) return this.cachedKey;

    const override = process.env.TRACE_MASTER_KEY;
    if (override) {
      this.logger.warn("Using TRACE_MASTER_KEY env override instead of macOS Keychain — intended for CI/test only.");
      this.cachedKey = Buffer.from(override, "base64");
      this.assertKeyLength(this.cachedKey);
      return this.cachedKey;
    }

    if (process.platform !== "darwin") {
      throw new Error(
        "No macOS Keychain available on this platform and TRACE_MASTER_KEY is not set. " +
          "Set TRACE_MASTER_KEY to a base64-encoded 32-byte key (see README.md Security model).",
      );
    }

    const existing = await this.readFromKeychain();
    if (existing) {
      this.cachedKey = existing;
      return existing;
    }

    const generated = randomBytes(32);
    await this.writeToKeychain(generated);
    this.logger.log("Generated a new TRACE master key and stored it in the macOS Keychain.");
    this.cachedKey = generated;
    return generated;
  }

  private assertKeyLength(key: Buffer): void {
    if (key.length !== 32) {
      throw new Error(`TRACE_MASTER_KEY must decode to exactly 32 bytes, got ${key.length}`);
    }
  }

  private async readFromKeychain(): Promise<Buffer | undefined> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-a",
        KEYCHAIN_ACCOUNT,
        "-s",
        KEYCHAIN_SERVICE,
        "-w",
      ]);
      const key = Buffer.from(stdout.trim(), "base64");
      this.assertKeyLength(key);
      return key;
    } catch {
      return undefined;
    }
  }

  private async writeToKeychain(key: Buffer): Promise<void> {
    await execFileAsync("security", [
      "add-generic-password",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
      key.toString("base64"),
      "-U",
    ]);
  }
}
