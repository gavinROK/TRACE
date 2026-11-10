import { ConnectorRegistryService } from "./connector-registry.service";
import { ProxmoxConnector } from "./proxmox/proxmox-connector";
import { SnmpConnector } from "./snmp/snmp-connector";
import { SshConnector } from "./ssh/ssh-connector";

describe("ConnectorRegistryService", () => {
  const registry = new ConnectorRegistryService(new SshConnector(), new ProxmoxConnector(), new SnmpConnector());

  it("resolves SSH, Proxmox, and SNMP to their connectors", () => {
    expect(registry.get("SSH")).toBeInstanceOf(SshConnector);
    expect(registry.get("PROXMOX_API")).toBeInstanceOf(ProxmoxConnector);
    expect(registry.get("SNMP_V3")).toBeInstanceOf(SnmpConnector);
  });

  it("returns undefined for a protocol with no connector", () => {
    expect(registry.get("WINDOWS_WINRM")).toBeUndefined();
  });

  it("require() throws for an unimplemented protocol", () => {
    expect(() => registry.require("DOCKER_API")).toThrow(/No connector implemented/);
  });
});
