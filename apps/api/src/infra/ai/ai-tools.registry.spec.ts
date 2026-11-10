import { BadRequestException } from "@nestjs/common";
import { AiActionClassification } from "@prisma/client";
import { AiToolsRegistryService, classifyToolCall } from "./ai-tools.registry";

describe("classifyToolCall", () => {
  it("classifies every read-only tool as READ_ONLY", () => {
    expect(classifyToolCall("list_devices", {})).toBe(AiActionClassification.READ_ONLY);
    expect(classifyToolCall("get_topology", {})).toBe(AiActionClassification.READ_ONLY);
    expect(classifyToolCall("check_device_health", { deviceId: "d1" })).toBe(AiActionClassification.READ_ONLY);
  });

  it("classifies execute_command and update_device as ADMINISTRATIVE", () => {
    expect(classifyToolCall("execute_command", { deviceName: "beelink", command: "uptime" })).toBe(AiActionClassification.ADMINISTRATIVE);
    expect(classifyToolCall("update_device", { deviceId: "d1", name: "new-name" })).toBe(AiActionClassification.ADMINISTRATIVE);
  });

  it("classifies perform_action('start') as ADMINISTRATIVE", () => {
    expect(classifyToolCall("perform_action", { deviceId: "d1", action: "start" })).toBe(AiActionClassification.ADMINISTRATIVE);
  });

  it("classifies perform_action('stop'|'shutdown'|'reboot') as DESTRUCTIVE — mirrors ActionsService.DESTRUCTIVE_ACTIONS exactly", () => {
    expect(classifyToolCall("perform_action", { deviceId: "d1", action: "stop" })).toBe(AiActionClassification.DESTRUCTIVE);
    expect(classifyToolCall("perform_action", { deviceId: "d1", action: "shutdown" })).toBe(AiActionClassification.DESTRUCTIVE);
    expect(classifyToolCall("perform_action", { deviceId: "d1", action: "reboot" })).toBe(AiActionClassification.DESTRUCTIVE);
  });

  it("fails safe (DESTRUCTIVE) for an unrecognized tool name, never auto-running an unknown capability", () => {
    expect(classifyToolCall("some_future_tool_nobody_classified", {})).toBe(AiActionClassification.DESTRUCTIVE);
  });
});

describe("AiToolsRegistryService", () => {
  const prisma = { infraMetricSample: { findMany: jest.fn() } };
  const environmentsService = { list: jest.fn() };
  const devicesService = { list: jest.fn(), get: jest.fn(), update: jest.fn() };
  const devicePollingService = { pollDevice: jest.fn() };
  const topologyService = { getSnapshot: jest.fn() };
  const auditLogService = { listForEnvironment: jest.fn() };
  const commandExecutionService = { executeOnDevice: jest.fn(), executeOnGroup: jest.fn() };
  const actionsService = { performAction: jest.fn() };
  const discoveryScanService = { detectLocalNetwork: jest.fn(), scanSubnet: jest.fn() };
  const credentialEnrollmentService = { authorizeSession: jest.fn() };
  const deviceOnboardingService = { configure: jest.fn(), verify: jest.fn() };

  const registry = new AiToolsRegistryService(
    prisma as never,
    environmentsService as never,
    devicesService as never,
    devicePollingService as never,
    topologyService as never,
    auditLogService as never,
    commandExecutionService as never,
    actionsService as never,
    discoveryScanService as never,
    credentialEnrollmentService as never,
    deviceOnboardingService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it("dispatches list_devices to InfraDevicesService.list scoped to the context environment", async () => {
    devicesService.list.mockResolvedValue([{ id: "d1" }]);
    const result = await registry.run("list_devices", {}, { environmentId: "env1", actor: "user:u1" });
    expect(devicesService.list).toHaveBeenCalledWith("env1");
    expect(result).toEqual([{ id: "d1" }]);
  });

  it("list_unenrolled_devices filters to DISCOVERED devices only", async () => {
    devicesService.list.mockResolvedValue([
      { id: "d1", enrollmentStatus: "DISCOVERED" },
      { id: "d2", enrollmentStatus: "ENROLLED" },
    ]);
    const result = (await registry.run("list_unenrolled_devices", {}, { environmentId: "env1", actor: "user:u1" })) as { id: string }[];
    expect(result).toEqual([{ id: "d1", enrollmentStatus: "DISCOVERED" }]);
  });

  it("get_vm_inventory filters devices by parentDevice id without triggering a new discovery scan", async () => {
    devicesService.list.mockResolvedValue([
      { id: "vm1", parentDevice: { id: "hv1" } },
      { id: "vm2", parentDevice: { id: "hv2" } },
    ]);
    const result = (await registry.run("get_vm_inventory", { hypervisorDeviceId: "hv1" }, { environmentId: "env1", actor: "user:u1" })) as { id: string }[];
    expect(result).toEqual([{ id: "vm1", parentDevice: { id: "hv1" } }]);
  });

  it("list_alerts honestly reports no alerting engine instead of fabricating alerts", async () => {
    devicesService.list.mockResolvedValue([{ id: "d1", name: "router", onlineState: "OFFLINE", lastContactAt: null }]);
    auditLogService.listForEnvironment.mockResolvedValue([]);
    const result = (await registry.run("list_alerts", {}, { environmentId: "env1", actor: "user:u1" })) as { alertingImplemented: boolean };
    expect(result.alertingImplemented).toBe(false);
  });

  it("execute_command passes the authenticated actor through to CommandExecutionService — never a different identity", async () => {
    commandExecutionService.executeOnDevice.mockResolvedValue({ status: "SUCCEEDED" });
    await registry.run("execute_command", { deviceName: "beelink", command: "uptime" }, { environmentId: "env1", actor: "user:u42" });
    expect(commandExecutionService.executeOnDevice).toHaveBeenCalledWith("env1", "user:u42", "beelink", "uptime", undefined);
  });

  it("perform_action is invoked with confirmed:true — the registry only runs calls the approval layer already approved", async () => {
    actionsService.performAction.mockResolvedValue({ success: true });
    await registry.run("perform_action", { deviceId: "d1", action: "stop" }, { environmentId: "env1", actor: "user:u1" });
    expect(actionsService.performAction).toHaveBeenCalledWith("env1", "user:u1", "d1", "stop", undefined, true);
  });

  it("request_credential_enrollment forwards the approver's own actor as authorizedBy — never the MCP actor", async () => {
    credentialEnrollmentService.authorizeSession.mockResolvedValue({ id: "ces1", status: "AUTHORIZED" });
    await registry.run(
      "request_credential_enrollment",
      { deviceId: "d1", protocol: "SSH", label: "router-ssh" },
      { environmentId: "env1", actor: "user:u1" },
    );
    expect(credentialEnrollmentService.authorizeSession).toHaveBeenCalledWith("env1", "d1", "SSH", "router-ssh", "user:u1");
  });

  it("request_credential_enrollment rejects an unrecognized protocol before ever reaching the service", async () => {
    await expect(
      registry.run("request_credential_enrollment", { deviceId: "d1", protocol: "TELNET" }, { environmentId: "env1", actor: "user:u1" }),
    ).rejects.toThrow(BadRequestException);
    expect(credentialEnrollmentService.authorizeSession).not.toHaveBeenCalled();
  });

  it("onboard_device forwards ip/name/category and the approver's actor to DeviceOnboardingService.configure", async () => {
    deviceOnboardingService.configure.mockResolvedValue({ nextStep: "..." });
    await registry.run("onboard_device", { ip: "192.168.0.1", name: "Router", category: "ROUTER" }, { environmentId: "env1", actor: "user:u1" });
    expect(deviceOnboardingService.configure).toHaveBeenCalledWith("env1", "user:u1", { ip: "192.168.0.1", name: "Router", category: "ROUTER" });
  });

  it("verify_device_onboarding forwards deviceId and actor to DeviceOnboardingService.verify", async () => {
    deviceOnboardingService.verify.mockResolvedValue({ ready: true });
    await registry.run("verify_device_onboarding", { deviceId: "d1" }, { environmentId: "env1", actor: "user:u1" });
    expect(deviceOnboardingService.verify).toHaveBeenCalledWith("env1", "d1", "user:u1");
  });

  it("classifies onboard_device as ADMINISTRATIVE and verify_device_onboarding as READ_ONLY", () => {
    expect(classifyToolCall("onboard_device", { ip: "192.168.0.1" })).toBe(AiActionClassification.ADMINISTRATIVE);
    expect(classifyToolCall("verify_device_onboarding", { deviceId: "d1" })).toBe(AiActionClassification.READ_ONLY);
  });

  it("throws BadRequestException for an unknown tool name", async () => {
    await expect(registry.run("delete_everything", {}, { environmentId: "env1", actor: "user:u1" })).rejects.toThrow(BadRequestException);
  });

  it("throws a descriptive error when a required argument is missing", async () => {
    await expect(registry.run("get_device", {}, { environmentId: "env1", actor: "user:u1" })).rejects.toThrow(/deviceId/);
  });
});
