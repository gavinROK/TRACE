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
  DEVICE_POSTURE_RISK: "device_posture_risk",
  /// A confirmed-missing-data fact, never a confirmed risk — deliberately
  /// a different type from DEVICE_POSTURE_RISK so the two are never
  /// visually or semantically conflated (see DeviceDataQualityRule).
  DEVICE_MISSING_SECURITY_INFO: "device_missing_security_info",
  DEVICE_STALE_CHECKIN: "device_stale_checkin",
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
  /**
   * Identifies the specific subject this finding is about (a device id,
   * a provider name, ...). Required whenever a single rule run could
   * produce more than one finding sharing the same (type, developerId)
   * pair — e.g. two devices owned by the same person, both flagged by
   * DevicePostureRule — otherwise the dedup check in
   * SecurityDetectionService would treat the second as a duplicate of
   * the first and silently drop it. Leave undefined only when the rule
   * can never produce more than one finding of this type for the same
   * developer (or org-wide) in a single run.
   */
  dedupeKey?: string;
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
