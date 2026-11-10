import { EventEmitter } from "node:events";
import { ProxmoxConnector } from "./proxmox-connector";

/**
 * node:https is mocked here — this verifies the connector's own request
 * building, auth header, JSON parsing, and action routing, not a real
 * Proxmox cluster. Running this against the real Beelink's Proxmox VE is
 * a separate, manual verification step (README.md "Proxmox integration").
 */
let responses: Record<string, { status: number; body: unknown }>;
let lastRequestOptions: Record<string, unknown> | undefined;

class FakeResponse extends EventEmitter {
  statusCode: number;
  constructor(statusCode: number) {
    super();
    this.statusCode = statusCode;
  }
}

jest.mock("node:https", () => ({
  request: jest.fn((options: Record<string, unknown>, callback: (res: FakeResponse) => void) => {
    lastRequestOptions = options;
    const key = `${options.method} ${options.path}`;
    const match = responses[key];
    const res = new FakeResponse(match ? match.status : 404);
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void; write: (chunk: string) => void };
    req.write = () => {};
    req.end = () => {
      queueMicrotask(() => {
        callback(res);
        queueMicrotask(() => {
          res.emit("data", Buffer.from(match ? JSON.stringify({ data: match.body }) : "not found"));
          res.emit("end");
        });
      });
    };
    req.destroy = () => {};
    return req;
  }),
}));

describe("ProxmoxConnector", () => {
  const connector = new ProxmoxConnector();
  const target = {
    deviceId: "pve-1",
    host: "10.0.0.2",
    metadata: { node: "beelink" },
    credential: {
      protocol: "PROXMOX_API" as const,
      payload: { tokenUser: "root@pam", tokenId: "trace", tokenSecret: "s3cr3t" },
    },
  };

  beforeEach(() => {
    responses = {};
    lastRequestOptions = undefined;
  });

  it("rejects when no API token is attached", async () => {
    await expect(
      connector.getHealth({ deviceId: "pve-1", host: "10.0.0.2", metadata: { node: "beelink" } }),
    ).resolves.toMatchObject({ onlineState: "OFFLINE" });
  });

  describe("node auto-discovery when metadata.node is not set", () => {
    const noNodeTarget = {
      deviceId: "pve-1",
      host: "10.0.0.2",
      credential: target.credential,
    };

    it("auto-discovers the node when Proxmox reports exactly one", async () => {
      responses["GET /api2/json/nodes"] = { status: 200, body: [{ node: "beelink" }] };
      responses["GET /api2/json/nodes/beelink/status"] = {
        status: 200,
        body: { uptime: 100, cpu: 0.1, memory: { used: 1, total: 2 }, rootfs: { used: 1, total: 4 } },
      };

      await expect(connector.getHealth(noNodeTarget)).resolves.toMatchObject({ onlineState: "ONLINE" });
    });

    it("reports OFFLINE (via a clear error) when there is more than one node and none was specified", async () => {
      responses["GET /api2/json/nodes"] = { status: 200, body: [{ node: "a" }, { node: "b" }] };

      const health = await connector.getHealth(noNodeTarget);

      expect(health.onlineState).toBe("OFFLINE");
      expect(health.detail).toMatch(/2 Proxmox nodes/);
    });
  });

  it("sends a PVEAPIToken authorization header", async () => {
    responses["GET /api2/json/nodes/beelink/status"] = {
      status: 200,
      body: { uptime: 100, cpu: 0.1, memory: { used: 1, total: 2 }, rootfs: { used: 1, total: 4 } },
    };

    await connector.getHealth(target);

    expect(lastRequestOptions?.headers).toMatchObject({
      Authorization: "PVEAPIToken=root@pam!trace=s3cr3t",
    });
  });

  it("reports ONLINE on a successful status call and OFFLINE on failure", async () => {
    responses["GET /api2/json/nodes/beelink/status"] = {
      status: 200,
      body: { uptime: 100, cpu: 0.1, memory: { used: 1, total: 2 }, rootfs: { used: 1, total: 4 } },
    };
    await expect(connector.getHealth(target)).resolves.toMatchObject({ onlineState: "ONLINE" });

    responses = {};
    await expect(connector.getHealth(target)).resolves.toMatchObject({ onlineState: "OFFLINE" });
  });

  it("converts node status into percent/second metric readings", async () => {
    responses["GET /api2/json/nodes/beelink/status"] = {
      status: 200,
      body: { uptime: 500, cpu: 0.42, memory: { used: 4, total: 8 }, rootfs: { used: 10, total: 100 } },
    };

    const readings = await connector.getMetrics(target);

    expect(readings.find((r) => r.kind === "CPU_UTILIZATION")?.value).toBeCloseTo(42);
    expect(readings.find((r) => r.kind === "MEMORY_UTILIZATION")?.value).toBeCloseTo(50);
    expect(readings.find((r) => r.kind === "UPTIME_SECONDS")?.value).toBe(500);
    expect(readings.find((r) => r.kind === "DISK_UTILIZATION")?.value).toBeCloseTo(10);
  });

  it("discovers nodes, VMs, and containers", async () => {
    responses["GET /api2/json/nodes"] = { status: 200, body: [{ node: "beelink" }] };
    responses["GET /api2/json/nodes/beelink/qemu"] = {
      status: 200,
      body: [{ vmid: 101, name: "ubuntu-server", status: "running" }],
    };
    responses["GET /api2/json/nodes/beelink/lxc"] = {
      status: 200,
      body: [{ vmid: 201, name: "pihole", status: "running" }],
    };

    const assets = await connector.discover(target);

    expect(assets).toEqual([
      { name: "beelink", host: "10.0.0.2", category: "PHYSICAL_SERVER", metadata: { node: "beelink" } },
      {
        name: "ubuntu-server",
        host: "10.0.0.2",
        category: "VIRTUAL_MACHINE",
        metadata: { node: "beelink", vmid: 101, status: "running", parentHost: "beelink" },
      },
      {
        name: "pihole",
        host: "10.0.0.2",
        category: "CONTAINER",
        metadata: { node: "beelink", vmid: 201, status: "running", parentHost: "beelink" },
      },
    ]);
  });

  it("rejects an unsupported action without calling the API", async () => {
    const result = await connector.performAction(
      { ...target, metadata: { node: "beelink", vmid: 101 } },
      "delete",
    );
    expect(result.success).toBe(false);
    expect(result.detail).toMatch(/Unsupported action/);
  });

  it("issues a supported action against the right qemu endpoint", async () => {
    responses["POST /api2/json/nodes/beelink/qemu/101/status/start"] = { status: 200, body: "UPID:..." };

    const result = await connector.performAction({ ...target, metadata: { node: "beelink", vmid: 101 } }, "start");

    expect(result).toEqual({ success: true, detail: "start issued for qemu 101 on beelink" });
  });

  describe("password/ticket authentication", () => {
    const passwordTarget = {
      deviceId: "pve-1",
      host: "10.0.0.2",
      metadata: { node: "beelink" },
      credential: {
        protocol: "PROXMOX_API" as const,
        payload: { username: "root@pam", password: "s3cr3t" },
      },
    };

    it("exchanges username/password for a ticket, then sends it as a cookie", async () => {
      responses["POST /api2/json/access/ticket"] = {
        status: 200,
        body: { ticket: "PVE:root@pam:TICKET", CSRFPreventionToken: "CSRF123" },
      };
      responses["GET /api2/json/nodes/beelink/status"] = {
        status: 200,
        body: { uptime: 100, cpu: 0.1, memory: { used: 1, total: 2 }, rootfs: { used: 1, total: 4 } },
      };

      await connector.getHealth(passwordTarget);

      expect(lastRequestOptions?.headers).toMatchObject({ Cookie: "PVEAuthCookie=PVE:root@pam:TICKET" });
    });

    it("sends the CSRF token on a POST (performAction) but not on a GET", async () => {
      responses["POST /api2/json/access/ticket"] = {
        status: 200,
        body: { ticket: "PVE:root@pam:TICKET", CSRFPreventionToken: "CSRF123" },
      };
      responses["POST /api2/json/nodes/beelink/qemu/101/status/start"] = { status: 200, body: "UPID:..." };

      await connector.performAction({ ...passwordTarget, metadata: { node: "beelink", vmid: 101 } }, "start");

      expect(lastRequestOptions?.headers).toMatchObject({ CSRFPreventionToken: "CSRF123" });
    });

    it("reports OFFLINE (via the login failure) when the password is wrong", async () => {
      responses["POST /api2/json/access/ticket"] = { status: 401, body: {} };

      await expect(connector.getHealth(passwordTarget)).resolves.toMatchObject({ onlineState: "OFFLINE" });
    });
  });

  it("rejects when a credential has neither a token nor a username/password", async () => {
    await expect(
      connector.getHealth({ ...target, credential: { protocol: "PROXMOX_API" as const, payload: {} } }),
    ).resolves.toMatchObject({ onlineState: "OFFLINE" });
  });
});
