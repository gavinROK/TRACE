import { TraceTelemetryClient, TraceTelemetryReportError } from "./trace-telemetry-client";

function mockFetch(response: { ok: boolean; status: number; text?: () => Promise<string> }) {
  return jest.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe("TraceTelemetryClient", () => {
  it("POSTs to <baseUrl>/telemetry/api-usage with a Bearer token and JSON body", async () => {
    const fetchImpl = mockFetch({ ok: true, status: 201 });
    const client = new TraceTelemetryClient({
      baseUrl: "http://localhost:4000",
      apiKey: "test-api-key",
      fetchImpl,
    });

    await client.reportApiUsage({
      actorType: "unknown",
      provider: "openai",
      service: "chat-completions",
      tokenCount: 1500,
      estimatedCostUsd: 0.003,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe("http://localhost:4000/telemetry/api-usage");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-api-key");
    expect(JSON.parse(init.body)).toEqual({
      actorType: "unknown",
      provider: "openai",
      service: "chat-completions",
      tokenCount: 1500,
      estimatedCostUsd: 0.003,
      occurredAt: undefined,
    });
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchImpl = mockFetch({ ok: true, status: 201 });
    const client = new TraceTelemetryClient({
      baseUrl: "http://localhost:4000/",
      apiKey: "key",
      fetchImpl,
    });

    await client.reportApiUsage({ actorType: "unknown", provider: "p", service: "s" });

    const [url] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe("http://localhost:4000/telemetry/api-usage");
  });

  it("serializes occurredAt as an ISO string", async () => {
    const fetchImpl = mockFetch({ ok: true, status: 201 });
    const client = new TraceTelemetryClient({ baseUrl: "http://x", apiKey: "k", fetchImpl });
    const occurredAt = new Date("2026-01-01T00:00:00.000Z");

    await client.reportApiUsage({ actorType: "unknown", provider: "p", service: "s", occurredAt });

    const [, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body).occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("throws TraceTelemetryReportError on a non-ok response", async () => {
    const fetchImpl = mockFetch({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Invalid API key"),
    });
    const client = new TraceTelemetryClient({ baseUrl: "http://x", apiKey: "bad", fetchImpl });

    await expect(
      client.reportApiUsage({ actorType: "unknown", provider: "p", service: "s" }),
    ).rejects.toThrow(TraceTelemetryReportError);
  });

  it("resolves without error on a 2xx response", async () => {
    const fetchImpl = mockFetch({ ok: true, status: 201 });
    const client = new TraceTelemetryClient({ baseUrl: "http://x", apiKey: "k", fetchImpl });

    await expect(
      client.reportApiUsage({ actorType: "unknown", provider: "p", service: "s" }),
    ).resolves.toBeUndefined();
  });
});
