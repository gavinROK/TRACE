import { Module } from "@nestjs/common";
import { ConnectorRegistryService } from "./connector-registry.service";
import { ProxmoxConnector } from "./proxmox/proxmox-connector";
import { SnmpConnector } from "./snmp/snmp-connector";
import { SshConnector } from "./ssh/ssh-connector";

@Module({
  providers: [SshConnector, ProxmoxConnector, SnmpConnector, ConnectorRegistryService],
  exports: [ConnectorRegistryService],
})
export class ConnectorsModule {}
