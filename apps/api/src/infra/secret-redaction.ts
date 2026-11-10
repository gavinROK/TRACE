/**
 * A defense-in-depth scrub, shared by both AI integration surfaces
 * (`ai/ai-chat.service.ts` for the native assistant, `approvals/` for
 * pending actions proposed by either surface — including an external
 * MCP client, TRACE v0.4) — PRODUCT_SPEC v0.3 section 10: "Do not
 * expose secrets in logs, chat history, or tool responses."
 *
 * This is not the primary control. The primary control is structural:
 * no tool handler in ai-tools.registry.ts ever calls
 * CredentialsService.getDecryptedForDevice or returns a connector
 * credential — every handler calls the exact same controller-reachable
 * service methods the REST API itself exposes, and those methods never
 * return a decrypted payload (see credentials.service.ts). This scrub
 * exists for the case a tool's output unexpectedly contains something
 * that looks like a secret anyway (e.g. a command's stdout happens to
 * print an API key some other system left in a config file) — it
 * cannot be the only safeguard, and it is not treated as one.
 */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, // Anthropic API key
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI-style API key
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\b[A-Za-z0-9+/]{20,}={0,2}\b(?=.*(?:secret|token|password|authTag))/gi,
  /("?(?:password|passwd|secret|api[_-]?key|authKey|privKey|tokenSecret)"?\s*[:=]\s*)"?[^"\s,}]{4,}"?/gi,
];

const REDACTED = "[REDACTED]";

export function redactSecrets(input: string): string {
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (...matchArgs: unknown[]) => {
      const group = typeof matchArgs[1] === "string" ? matchArgs[1] : undefined;
      return group ? `${group}${REDACTED}` : REDACTED;
    });
  }
  return result;
}

const SECRET_FIELD_NAMES = new Set([
  "password",
  "passwd",
  "secret",
  "apikey",
  "api_key",
  "authkey",
  "privkey",
  "privatekey",
  "tokensecret",
  "token",
  "authtag",
  "encryptedpayload",
  "iv",
]);

/** Applies redactSecrets to every string leaf of a JSON-ish value — tool
 * inputs/outputs are usually objects/arrays, not raw strings. A plain
 * string leaf only has its own text to go on, so pattern matching
 * (SECRET_PATTERNS) is all that applies there; inside an object, a
 * value is redacted outright whenever its *key name* looks secret-
 * shaped, since "tokenSecret": "abcd1234" has no colon inside the leaf
 * string itself for a pattern to match against. */
export function redactSecretsDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactSecretsDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && SECRET_FIELD_NAMES.has(key.toLowerCase())) {
        out[key] = REDACTED;
      } else {
        out[key] = redactSecretsDeep(v);
      }
    }
    return out as unknown as T;
  }
  return value;
}
