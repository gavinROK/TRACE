import { ApiUsageReport, TraceTelemetryClientOptions } from "./types";

export class TraceTelemetryReportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TraceTelemetryReportError";
  }
}

/**
 * Reports API usage metadata to a TRACE backend. See ./types.ts for
 * exactly what is (and deliberately is not) collected.
 */
export class TraceTelemetryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TraceTelemetryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async reportApiUsage(report: ApiUsageReport): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/telemetry/api-usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        ...report,
        occurredAt: report.occurredAt?.toISOString(),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new TraceTelemetryReportError(
        `TRACE telemetry report failed with status ${response.status}: ${body}`,
        response.status,
      );
    }
  }
}
