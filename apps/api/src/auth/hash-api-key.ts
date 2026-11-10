import { createHash } from "node:crypto";

/**
 * Only the hash of an API key is ever stored or compared — the raw key
 * exists only in the client's possession and in memory for the duration
 * of a request.
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}
