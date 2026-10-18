import { AlertSeverity } from "@prisma/client";

/**
 * Known SecurityAlert.type values, one per rule below. Kept as plain
 * strings (not a Prisma enum) for the same reason as ActivityEventType:
 * new rules shouldn't need a migration to add a type.
 */
export const SecurityAlertType = {
  API_USAGE_SPIKE: "api_usage_spike",
  ELEVATED_API_ERROR_RATE: "elevated_api_error_rate",
  UNUSUAL_COMMIT_VOLUME: "unusual_commit_volume",
} as const;

export type SecurityAlertType = (typeof SecurityAlertType)[keyof typeof SecurityAlertType];

/**
 * What a rule hands back when it fires. Not yet persisted — the caller
 * decides whether an equivalent alert is already open before writing one.
 *
 * Every finding must explain itself: `reason` is read by a human deciding
 * whether to investigate, and `evidence` is the exact numbers the rule
 * computed, so the alert is reproducible and arguable, not a black box.
 */
export interface SecurityFinding {
  type: SecurityAlertType;
  severity: AlertSeverity;
  /** Set when the finding is about one developer specifically. */
  developerId?: string;
  reason: string;
  recommendedSteps: string[];
  evidence: Record<string, unknown>;
}

/**
 * A deterministic, explainable detection rule. Rules compute only from
 * data already in our own database (API usage events, activity events) —
 * none of them call out to GitHub's audit log API, which most accounts
 * don't even have access to (see docs/DEVELOPMENT_STATUS.md).
 *
 * Statistical anomalies are not evidence of wrongdoing — every rule's
 * `reason` and `recommendedSteps` must read as "worth a human look," never
 * as an accusation.
 */
export interface SecurityRule {
  evaluate(organizationId: string): Promise<SecurityFinding[]>;
}

export const SECURITY_RULES = Symbol("SECURITY_RULES");
