import { computePostureStatus, listFailingChecks } from "./device-posture";

const ALL_UNKNOWN = {
  diskEncrypted: null,
  firewallEnabled: null,
  osUpToDate: null,
  screenLockEnabled: null,
};

describe("computePostureStatus", () => {
  it("returns UNKNOWN when nothing has been checked", () => {
    expect(computePostureStatus(ALL_UNKNOWN)).toBe("UNKNOWN");
  });

  it("returns HEALTHY when every known check passes, regardless of unknowns", () => {
    expect(
      computePostureStatus({ ...ALL_UNKNOWN, diskEncrypted: true, firewallEnabled: true }),
    ).toBe("HEALTHY");
  });

  it("returns HEALTHY when all four checks pass", () => {
    expect(
      computePostureStatus({
        diskEncrypted: true,
        firewallEnabled: true,
        osUpToDate: true,
        screenLockEnabled: true,
      }),
    ).toBe("HEALTHY");
  });

  it("returns AT_RISK when exactly one check fails", () => {
    expect(computePostureStatus({ ...ALL_UNKNOWN, diskEncrypted: false })).toBe("AT_RISK");
  });

  it("returns CRITICAL when two or more checks fail", () => {
    expect(
      computePostureStatus({ ...ALL_UNKNOWN, diskEncrypted: false, firewallEnabled: false }),
    ).toBe("CRITICAL");
  });

  it("never treats null as a failure", () => {
    // Three unknowns, one explicit pass — must not be CRITICAL/AT_RISK.
    expect(computePostureStatus({ ...ALL_UNKNOWN, osUpToDate: true })).toBe("HEALTHY");
  });
});

describe("listFailingChecks", () => {
  it("lists only the checks that are explicitly false", () => {
    expect(
      listFailingChecks({
        diskEncrypted: false,
        firewallEnabled: true,
        osUpToDate: null,
        screenLockEnabled: false,
      }),
    ).toEqual(["disk encryption", "screen lock"]);
  });

  it("returns an empty list when nothing is failing", () => {
    expect(listFailingChecks(ALL_UNKNOWN)).toEqual([]);
  });
});
