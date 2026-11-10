/** Mirrors apps/api/src/telemetry/telemetry.service.ts's response shapes. */
export interface ProviderUsageSummary {
  provider: string;
  requestCount: number;
  tokenCount: number;
  estimatedCostUsd: number;
  errorCount: number;
  averageLatencyMs: number | null;
}

export interface DailyUsagePoint {
  date: string;
  requestCount: number;
  estimatedCostUsd: number;
}
