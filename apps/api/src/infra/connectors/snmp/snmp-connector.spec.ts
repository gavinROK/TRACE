import { SnmpConnector } from "./snmp-connector";

/**
 * net-snmp is mocked — this verifies credential handling, OID parsing,
 * and the GET/WALK plumbing without a real SNMPv3 agent. Running this
 * against the NETGEAR GS108T is a separate, manual verification step.
 */
let fakeSession: {
  get: jest.Mock;
  subtree: jest.Mock;
  close: jest.Mock;
};

jest.mock("net-snmp", () => ({
  createV3Session: jest.fn(() => fakeSession),
  isVarbindError: jest.fn(() => false),
  varbindError: jest.fn(() => "error"),
  SecurityLevel: { authNoPriv: 1, authPriv: 3 },
  AuthProtocols: { sha: 2, md5: 1 },
  PrivProtocols: { aes: 2, des: 1 },
}));

describe("SnmpConnector", () => {
  const connector = new SnmpConnector();
  const target = {
    deviceId: "switch-1",
    host: "10.0.0.3",
    credential: {
      protocol: "SNMP_V3" as const,
      payload: { username: "trace-ro", authProtocol: "SHA" as const, authKey: "authpass123" },
    },
  };

  beforeEach(() => {
    fakeSession = { get: jest.fn(), subtree: jest.fn(), close: jest.fn() };
  });

  it("reports OFFLINE when no credential is attached", async () => {
    const health = await connector.getHealth({ deviceId: "switch-1", host: "10.0.0.3" });
    expect(health.onlineState).toBe("OFFLINE");
  });

  it("reports ONLINE when sysUpTime GET succeeds", async () => {
    fakeSession.get.mockImplementation((_oids, cb) => cb(null, [{ value: 12345 }]));

    const health = await connector.getHealth(target);

    expect(health.onlineState).toBe("ONLINE");
    expect(fakeSession.close).toHaveBeenCalled();
  });

  it("reports OFFLINE when the GET errors", async () => {
    fakeSession.get.mockImplementation((_oids, cb) => cb(new Error("timeout")));

    const health = await connector.getHealth(target);

    expect(health.onlineState).toBe("OFFLINE");
  });

  it("parses ifDescr/ifSpeed pairs from a table walk into labeled readings", async () => {
    fakeSession.subtree.mockImplementation((_oid, feed, done) => {
      feed([
        { oid: "1.3.6.1.2.1.2.2.1.2.1", value: Buffer.from("eth0") },
        { oid: "1.3.6.1.2.1.2.2.1.5.1", value: 1000000000 },
      ]);
      done(null);
    });

    const readings = await connector.getMetrics(target);

    expect(readings).toEqual([
      { kind: "CUSTOM", label: "ifSpeed[eth0]", value: 1000000000, unit: "bps", collectedAt: expect.any(Date) },
    ]);
  });
});
