/** Mirrors the shape apps/api's SecurityAlertsController returns. */
export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AlertStatus = "OPEN" | "INVESTIGATING" | "RESOLVED" | "DISMISSED";

export interface SecurityAlertRecord {
  id: string;
  developerId: string | null;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  detectedAt: string;
  reason: string;
  recommendedSteps: string[];
  evidence: Record<string, unknown>;
}

export const ALERT_STATUSES: AlertStatus[] = ["OPEN", "INVESTIGATING", "RESOLVED", "DISMISSED"];

export function formatAlertType(type: string): string {
  return type
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
