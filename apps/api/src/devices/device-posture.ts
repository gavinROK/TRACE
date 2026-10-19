export type DevicePostureStatus = "HEALTHY" | "AT_RISK" | "CRITICAL" | "UNKNOWN";

export interface DevicePostureFlags {
  diskEncrypted: boolean | null;
  firewallEnabled: boolean | null;
  osUpToDate: boolean | null;
  screenLockEnabled: boolean | null;
}

/**
 * Shared by DevicesService (for display) and DevicePostureRule (for
 * detection), so the two always agree on what "at risk" means.
 *
 * `null` never counts as a finding — it means TRACE has no data for that
 * check (e.g. a manually-enrolled device with no agent), which is a
 * different fact than "verified disabled." Only an explicit `false`
 * counts.
 */
export function computePostureStatus(flags: DevicePostureFlags): DevicePostureStatus {
  const values = [flags.diskEncrypted, flags.firewallEnabled, flags.osUpToDate, flags.screenLockEnabled];
  const failCount = values.filter((value) => value === false).length;
  const knownCount = values.filter((value) => value !== null).length;

  if (failCount >= 2) return "CRITICAL";
  if (failCount === 1) return "AT_RISK";
  if (knownCount === 0) return "UNKNOWN";
  return "HEALTHY";
}

/** Human-readable list of which specific checks are failing, for alert/UI text. */
export function listFailingChecks(flags: DevicePostureFlags): string[] {
  const labels: Array<[keyof DevicePostureFlags, string]> = [
    ["diskEncrypted", "disk encryption"],
    ["firewallEnabled", "firewall"],
    ["osUpToDate", "OS updates"],
    ["screenLockEnabled", "screen lock"],
  ];
  return labels.filter(([key]) => flags[key] === false).map(([, label]) => label);
}
