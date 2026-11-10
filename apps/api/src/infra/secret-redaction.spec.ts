import { redactSecrets, redactSecretsDeep } from "./secret-redaction";

describe("redactSecrets", () => {
  it("redacts an Anthropic-style API key", () => {
    const input = "Here is my key: sk-ant-abcdefghijklmnopqrstuvwxyz1234567890";
    expect(redactSecrets(input)).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz1234567890");
    expect(redactSecrets(input)).toContain("[REDACTED]");
  });

  it("redacts a PEM private key block", () => {
    const input = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----";
    expect(redactSecrets(input)).toBe("[REDACTED]");
  });

  it("redacts a GitHub token", () => {
    const input = "token=ghp_" + "a".repeat(36);
    expect(redactSecrets(input)).not.toContain("ghp_" + "a".repeat(36));
  });

  it("redacts a key=value secret field while keeping the key name", () => {
    const input = '{"password": "SuperSecret123!"}';
    const result = redactSecrets(input);
    expect(result).toContain("password");
    expect(result).not.toContain("SuperSecret123!");
  });

  it("leaves ordinary text untouched", () => {
    const input = "uptime: 14 days, memory usage 42%";
    expect(redactSecrets(input)).toBe(input);
  });
});

describe("redactSecretsDeep", () => {
  it("redacts nested string leaves in an object", () => {
    const input = { device: "beelink", credential: { tokenSecret: "abcd1234verysecret" }, tags: ["ok", "sk-ant-" + "x".repeat(24)] };
    const result = redactSecretsDeep(input) as typeof input;
    expect(result.device).toBe("beelink");
    expect(JSON.stringify(result)).not.toContain("abcd1234verysecret");
    expect(JSON.stringify(result)).not.toContain("sk-ant-" + "x".repeat(24));
  });

  it("passes through non-string primitives unchanged", () => {
    expect(redactSecretsDeep(42)).toBe(42);
    expect(redactSecretsDeep(null)).toBe(null);
    expect(redactSecretsDeep(true)).toBe(true);
  });
});
