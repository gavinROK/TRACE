import { createHmac } from "node:crypto";
import { verifyGithubWebhookSignature } from "./verify-github-webhook-signature";

const SECRET = "test-webhook-secret";

function sign(payload: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

describe("verifyGithubWebhookSignature", () => {
  it("accepts a correctly-signed payload", () => {
    const payload = Buffer.from(JSON.stringify({ zen: "Responsive is better than fast." }));
    const signature = sign(payload, SECRET);

    expect(verifyGithubWebhookSignature(payload, signature, SECRET)).toBe(true);
  });

  it("rejects a payload signed with a different secret", () => {
    const payload = Buffer.from(JSON.stringify({ zen: "Responsive is better than fast." }));
    const signature = sign(payload, "a-different-secret");

    expect(verifyGithubWebhookSignature(payload, signature, SECRET)).toBe(false);
  });

  it("rejects a tampered payload even with a validly-formed signature", () => {
    const originalPayload = Buffer.from(JSON.stringify({ amount: 10 }));
    const signature = sign(originalPayload, SECRET);
    const tamperedPayload = Buffer.from(JSON.stringify({ amount: 10000 }));

    expect(verifyGithubWebhookSignature(tamperedPayload, signature, SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const payload = Buffer.from("{}");

    expect(verifyGithubWebhookSignature(payload, undefined, SECRET)).toBe(false);
  });

  it("rejects a signature header missing the sha256= prefix", () => {
    const payload = Buffer.from("{}");
    const rawHex = createHmac("sha256", SECRET).update(payload).digest("hex");

    expect(verifyGithubWebhookSignature(payload, rawHex, SECRET)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    const payload = Buffer.from("{}");

    expect(() =>
      verifyGithubWebhookSignature(payload, "sha256=deadbeef", SECRET),
    ).not.toThrow();
    expect(verifyGithubWebhookSignature(payload, "sha256=deadbeef", SECRET)).toBe(false);
  });
});
