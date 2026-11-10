import { TraceClient, TraceClientError } from "./trace-client";

describe("TraceClient", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock;
  });

  const client = new TraceClient({ baseUrl: "http://localhost:4000", serviceToken: "secret-token" });

  it("sends the service token as a Bearer header on every request", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    await client.listEnvironments();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/infra/environments",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret-token" }) }),
    );
  });

  it("throws TraceClientError with the API's message on a non-2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found", json: async () => ({ message: "Device not found" }) });

    await expect(client.getDevice("env1", "missing")).rejects.toThrow(TraceClientError);
    await expect(client.getDevice("env1", "missing")).rejects.toThrow("Device not found");
  });

  it("builds the exec-group request body with confirm and timeout", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    await client.executeGroupCommand("env1", ["a", "b"], "uptime", 5000, true);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ deviceNames: ["a", "b"], command: "uptime", timeoutMs: 5000, confirm: true });
  });

  it("checks a pending action's status via a GET to the shared pending-actions endpoint", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "APPROVED" }) });

    await client.getPendingActionStatus("env1", "pa1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/infra/environments/env1/ai/pending-actions/pa1",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret-token" }) }),
    );
  });

  it("requestCredentialEnrollment posts only protocol/label — never a secret field", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ pending: true, pendingActionId: "pa1" }) });

    await client.requestCredentialEnrollment("env1", "d1", "SSH", "router-ssh");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/infra/environments/env1/devices/d1/credential-enrollment-sessions",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ protocol: "SSH", label: "router-ssh" }) }),
    );
  });

  it("getCredentialEnrollmentStatus reads the active-session endpoint — no body, no secret", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "AUTHORIZED", secondsRemaining: 240 }) });

    const result = await client.getCredentialEnrollmentStatus("env1", "d1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/infra/environments/env1/devices/d1/credential-enrollment-sessions/active",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret-token" }) }),
    );
    expect(result).toEqual({ status: "AUTHORIZED", secondsRemaining: 240 });
  });
});
