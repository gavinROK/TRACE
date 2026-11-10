import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./secret-cipher";

describe("secret-cipher", () => {
  it("round-trips a credential payload", () => {
    const key = randomBytes(32);
    const payload = { username: "gavin", password: "s3cret!" };

    const encrypted = encryptSecret(payload, key);
    const decrypted = decryptSecret(encrypted, key);

    expect(decrypted).toEqual(payload);
  });

  it("never stores the plaintext in the ciphertext field", () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret({ password: "super-secret-value" }, key);

    expect(encrypted.encryptedPayload).not.toContain("super-secret-value");
  });

  it("produces a different IV (and ciphertext) on every call", () => {
    const key = randomBytes(32);
    const a = encryptSecret({ token: "x" }, key);
    const b = encryptSecret({ token: "x" }, key);

    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedPayload).not.toBe(b.encryptedPayload);
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptSecret({ token: "x" }, randomBytes(32));

    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow();
  });

  it("fails to decrypt if the ciphertext was tampered with", () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret({ token: "x" }, key);
    const tampered = { ...encrypted, encryptedPayload: Buffer.from("tampered").toString("base64") };

    expect(() => decryptSecret(tampered, key)).toThrow();
  });
});
