import { ForbiddenException } from "@nestjs/common";
import { classifyHealthFailure, DeviceOnboardingService } from "./device-onboarding.service";

describe("classifyHealthFailure", () => {
  it("recognizes an authentication failure", () => {
    expect(classifyHealthFailure("All configured authentication methods failed")).toBe("authentication");
    expect(classifyHealthFailure("Permission denied (publickey,password)")).toBe("authentication");
  });

  it("recognizes an unreachable host", () => {
    expect(classifyHealthFailure("connect ECONNREFUSED 192.168.0.1:22")).toBe("unreachable");
    expect(classifyHealthFailure("connect ETIMEDOUT")).toBe("unreachable");
  });

  it("recognizes a host-key mismatch", () => {
    expect(classifyHealthFailure("Host key MISMATCH for 10.0.0.5 — refusing to connect")).toBe("host-key-mismatch");
  });

  it("falls back to unknown rather than guessing wrong, and never throws on empty input", () => {
    expect(classifyHealthFailure("some unrecognized connector error")).toBe("unknown");
    expect(classifyHealthFailure(undefined)).toBe("unknown");
  });
});

describe("DeviceOnboardingService", () => {
  const discoveryScan = {
    assertAuthorizedTarget: jest.fn(),
    probeManagementPorts: jest.fn(),
    importCandidate: jest.fn(),
  };
  const devicesService = { update: jest.fn(), get: jest.fn(), markEnrolled: jest.fn() };
  const credentialsService = { listForEnvironment: jest.fn() };
  const devicePolling = { pollDevice: jest.fn() };
  const connectorRegistry = { get: jest.fn() };
  const auditLog = { record: jest.fn() };

  const service = new DeviceOnboardingService(
    discoveryScan as never,
    devicesService as never,
    credentialsService as never,
    devicePolling as never,
    connectorRegistry as never,
    auditLog as never,
  );

  beforeEach(() => jest.clearAllMocks());

  describe("configure", () => {
    it("refuses an IP outside the authorized subnet before doing anything else", async () => {
      discoveryScan.assertAuthorizedTarget.mockRejectedValue(new ForbiddenException("outside subnet"));

      await expect(service.configure("env1", "user:u1", { ip: "10.0.0.1" })).rejects.toThrow(ForbiddenException);
      expect(discoveryScan.importCandidate).not.toHaveBeenCalled();
    });

    it("never assigns a protocol candidate TRACE has no connector for, even if the port probe says open", async () => {
      discoveryScan.assertAuthorizedTarget.mockResolvedValue(undefined);
      discoveryScan.probeManagementPorts.mockResolvedValue([
        { port: 5985, open: true, protocolHint: "WINDOWS_WINRM" }, // open, but no connector exists
      ]);
      discoveryScan.importCandidate.mockResolvedValue({
        device: { id: "d1", name: "192.168.0.1", category: "GENERIC_NETWORK_DEVICE", ipAddresses: ["192.168.0.1"], managementProtocols: [] },
        action: "created",
      });
      connectorRegistry.get.mockReturnValue(undefined); // no WINRM connector implemented
      credentialsService.listForEnvironment.mockResolvedValue([]);

      const result = await service.configure("env1", "user:u1", { ip: "192.168.0.1" });

      expect(result.protocolCandidates).toEqual([]);
      expect(devicesService.update).not.toHaveBeenCalled();
      expect(result.nextStep).toMatch(/no management protocol could be inferred/i);
    });

    it("sets only protocol candidates with a real connector, and dedupes an open port already on the device", async () => {
      discoveryScan.assertAuthorizedTarget.mockResolvedValue(undefined);
      discoveryScan.probeManagementPorts.mockResolvedValue([
        { port: 22, open: true, protocolHint: "SSH" },
        { port: 8006, open: false, protocolHint: "PROXMOX_API" },
      ]);
      discoveryScan.importCandidate.mockResolvedValue({
        device: { id: "d1", name: "Router", category: "ROUTER", ipAddresses: ["192.168.0.1"], managementProtocols: [] },
        action: "created",
      });
      connectorRegistry.get.mockImplementation((p: string) => (p === "SSH" ? {} : undefined));
      devicesService.update.mockResolvedValue({
        id: "d1",
        name: "Router",
        category: "ROUTER",
        ipAddresses: ["192.168.0.1"],
        managementProtocols: ["SSH"],
      });
      credentialsService.listForEnvironment.mockResolvedValue([]);

      const result = await service.configure("env1", "user:u1", { ip: "192.168.0.1" });

      expect(devicesService.update).toHaveBeenCalledWith("env1", "d1", "user:u1", { managementProtocols: ["SSH"] });
      expect(result.protocolCandidates).toEqual(["SSH"]);
      expect(result.hasCredential).toBe(false);
      expect(result.nextStep).toMatch(/request_credential_enrollment/);
    });

    it("reports hasCredential:true and points to verify when a usable credential already exists", async () => {
      discoveryScan.assertAuthorizedTarget.mockResolvedValue(undefined);
      discoveryScan.probeManagementPorts.mockResolvedValue([{ port: 22, open: true, protocolHint: "SSH" }]);
      discoveryScan.importCandidate.mockResolvedValue({
        device: { id: "d1", name: "Router", category: "ROUTER", ipAddresses: ["192.168.0.1"], managementProtocols: ["SSH"] },
        action: "merged",
      });
      connectorRegistry.get.mockReturnValue({});
      credentialsService.listForEnvironment.mockResolvedValue([{ id: "c1", deviceId: "d1", protocol: "SSH" }]);

      const result = await service.configure("env1", "user:u1", { ip: "192.168.0.1" });

      expect(devicesService.update).not.toHaveBeenCalled(); // SSH already on the device — nothing new to add
      expect(result.hasCredential).toBe(true);
      expect(result.nextStep).toMatch(/verify_device_onboarding/);
    });

    it("binds the audit record to the exact ip/importAction/candidates observed", async () => {
      discoveryScan.assertAuthorizedTarget.mockResolvedValue(undefined);
      discoveryScan.probeManagementPorts.mockResolvedValue([{ port: 22, open: true, protocolHint: "SSH" }]);
      discoveryScan.importCandidate.mockResolvedValue({
        device: { id: "d1", name: "Router", category: "ROUTER", ipAddresses: ["192.168.0.1"], managementProtocols: [] },
        action: "created",
      });
      connectorRegistry.get.mockReturnValue({});
      devicesService.update.mockResolvedValue({ id: "d1", name: "Router", category: "ROUTER", ipAddresses: ["192.168.0.1"], managementProtocols: ["SSH"] });
      credentialsService.listForEnvironment.mockResolvedValue([]);

      await service.configure("env1", "user:u1", { ip: "192.168.0.1" });

      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "device.onboarding.configured",
          actor: "user:u1",
          targetId: "d1",
          detail: expect.objectContaining({ ip: "192.168.0.1", importAction: "created", protocolCandidates: ["SSH"] }),
        }),
      );
    });
  });

  describe("verify", () => {
    it("reports not-ready, without ever calling pollDevice, when no protocol is set yet", async () => {
      devicesService.get.mockResolvedValue({ managementProtocols: [], credentials: [], onlineState: "UNKNOWN", enrollmentStatus: "DISCOVERED" });

      const result = await service.verify("env1", "d1", "user:u1");

      expect(result.ready).toBe(false);
      expect(devicePolling.pollDevice).not.toHaveBeenCalled();
    });

    it("reports not-ready, without ever calling pollDevice, when no credential exists yet (recovery from partial setup)", async () => {
      devicesService.get.mockResolvedValue({ managementProtocols: ["SSH"], credentials: [], onlineState: "UNKNOWN", enrollmentStatus: "DISCOVERED" });

      const result = await service.verify("env1", "d1", "user:u1");

      expect(result.ready).toBe(false);
      expect(result.reason).toMatch(/trace_request_credential_enrollment/);
      expect(devicePolling.pollDevice).not.toHaveBeenCalled();
    });

    it("marks the device ENROLLED only after a real poll comes back ONLINE", async () => {
      devicesService.get.mockResolvedValue({ managementProtocols: ["SSH"], credentials: [{ id: "c1" }], onlineState: "UNKNOWN", enrollmentStatus: "DISCOVERED" });
      devicePolling.pollDevice.mockResolvedValue({ onlineState: "ONLINE", detail: undefined, checkedAt: new Date(), metricsCollected: 2 });
      devicesService.markEnrolled.mockResolvedValue({ enrollmentStatus: "ENROLLED" });

      const result = await service.verify("env1", "d1", "user:u1");

      expect(devicesService.markEnrolled).toHaveBeenCalledWith("env1", "d1", "user:u1");
      expect(result.enrollmentStatus).toBe("ENROLLED");
      expect(result.monitoringEligible).toBe(true);
      expect(result.failureCategory).toBeUndefined();
    });

    it("never marks ENROLLED and surfaces a failure category when the poll fails — distinguishes auth from unreachable", async () => {
      devicesService.get.mockResolvedValue({ managementProtocols: ["SSH"], credentials: [{ id: "c1" }], onlineState: "UNKNOWN", enrollmentStatus: "DISCOVERED" });
      devicePolling.pollDevice.mockResolvedValue({ onlineState: "OFFLINE", detail: "All configured authentication methods failed", checkedAt: new Date(), metricsCollected: 0 });

      const result = await service.verify("env1", "d1", "user:u1");

      expect(devicesService.markEnrolled).not.toHaveBeenCalled();
      expect(result.enrollmentStatus).toBe("DISCOVERED");
      expect(result.monitoringEligible).toBe(false);
      expect(result.failureCategory).toBe("authentication");
    });
  });
});
