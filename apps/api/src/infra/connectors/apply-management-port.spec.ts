import { withManagementPort } from "./apply-management-port";

describe("withManagementPort", () => {
  const credential = { protocol: "SSH" as const, payload: { username: "gavin" } };

  it("applies the device's managementPort when the credential has none", () => {
    expect(withManagementPort(credential, 2222)).toEqual({
      protocol: "SSH",
      payload: { username: "gavin", port: 2222 },
    });
  });

  it("leaves the credential untouched when managementPort is not set", () => {
    expect(withManagementPort(credential, null)).toBe(credential);
    expect(withManagementPort(credential, undefined)).toBe(credential);
  });

  it("never overrides a port already present in the credential payload", () => {
    const withOwnPort = { protocol: "SSH" as const, payload: { username: "gavin", port: 22 } };

    expect(withManagementPort(withOwnPort, 2222)).toBe(withOwnPort);
  });
});
