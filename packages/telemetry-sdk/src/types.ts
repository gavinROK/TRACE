/**
 * How confidently this event is attributed to a specific developer.
 * "verified" requires `developerId` to be set to an id the calling system
 * actually authenticated — never set this just because a name was guessed
 * from a request header or similar.
 */
export type ActorType = "verified" | "inferred" | "unknown";

/**
 * One unit of API usage. Deliberately has no field for API keys, prompt
 * text, response bodies, or any other request/response payload — TRACE
 * collects usage *metadata* only. If you find yourself wanting to put
 * sensitive content in `provider` or `service`, don't; use a short
 * identifier like "openai" / "chat-completions" instead.
 */
export interface ApiUsageReport {
  /** Required. How confident this event's attribution is — see ActorType. */
  actorType: ActorType;
  /** e.g. "openai", "anthropic", "internal-billing-service". */
  provider: string;
  /** e.g. "chat-completions", "embeddings". */
  service: string;
  /** Set only when actorType is "verified" or "inferred" and you actually know who. */
  developerId?: string;
  requestCount?: number;
  tokenCount?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  errorCount?: number;
  /** Defaults to "now" on the server if omitted. */
  occurredAt?: Date;
}

export interface TraceTelemetryClientOptions {
  /** Base URL of the TRACE API, e.g. "https://trace.example.com" or "http://localhost:4000". */
  baseUrl: string;
  /** The organization's API key. Never log or persist this outside your own secret storage. */
  apiKey: string;
  /** Override fetch (e.g. for testing). Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}
