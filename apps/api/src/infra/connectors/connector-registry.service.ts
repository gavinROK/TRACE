import { Injectable } from "@nestjs/common";
import { InfraManagementProtocol } from "@prisma/client";
import { ProxmoxConnector } from "./proxmox/proxmox-connector";
import { SnmpConnector } from "./snmp/snmp-connector";
import { SshConnector } from "./ssh/ssh-connector";
import type { InfraConnector } from "./connector.types";

/** Resolves a management protocol to the one connector implementation
 * for it. Every other infra service (discovery, console, monitoring)
 * goes through this instead of importing a connector directly, so
 * adding a new protocol never means touching those call sites. */
@Injectable()
export class ConnectorRegistryService {
  private readonly connectors: Map<InfraManagementProtocol, InfraConnector>;

  constructor(ssh: SshConnector, proxmox: ProxmoxConnector, snmp: SnmpConnector) {
    this.connectors = new Map<InfraManagementProtocol, InfraConnector>([
      [InfraManagementProtocol.SSH, ssh],
      [InfraManagementProtocol.PROXMOX_API, proxmox],
      [InfraManagementProtocol.SNMP_V3, snmp],
    ]);
  }

  get(protocol: InfraManagementProtocol): InfraConnector | undefined {
    return this.connectors.get(protocol);
  }

  require(protocol: InfraManagementProtocol): InfraConnector {
    const connector = this.get(protocol);
    if (!connector) {
      throw new Error(`No connector implemented for protocol ${protocol}`);
    }
    return connector;
  }
}
