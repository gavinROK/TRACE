import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export interface EncryptedPayload {
  encryptedPayload: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts a credential payload (SSH password/key, Proxmox API token,
 * SNMPv3 keys, ...) with AES-256-GCM. The caller supplies the master
 * key — see master-key.store.ts for where that key itself lives. No
 * custom cryptography: this is Node's built-in `crypto`, using the
 * standard authenticated-encryption construction (random 96-bit IV per
 * encryption, GCM auth tag, base64 at rest).
 */
export function encryptSecret(plaintext: Record<string, unknown>, masterKey: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);
  return {
    encryptedPayload: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(encrypted: EncryptedPayload, masterKey: Buffer): Record<string, unknown> {
  const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.encryptedPayload, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}
