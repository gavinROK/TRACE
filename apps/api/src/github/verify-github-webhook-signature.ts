import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

/**
 * Verifies a GitHub webhook's `X-Hub-Signature-256` header against the
 * raw request body, per GitHub's documented scheme:
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 *
 * `payload` must be the exact raw bytes GitHub sent — computing the HMAC
 * over a re-serialized/re-parsed body will not match.
 */
export function verifyGithubWebhookSignature(
  payload: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expectedHex = createHmac("sha256", secret).update(payload).digest("hex");
  const expected = Buffer.from(expectedHex, "utf8");
  const received = Buffer.from(signatureHeader.slice(SIGNATURE_PREFIX.length), "utf8");

  // timingSafeEqual throws on mismatched lengths, so check that first —
  // doing so leaks only the (constant-ish) expected length, not any
  // information about which bytes of the received signature are wrong.
  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}
