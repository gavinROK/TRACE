import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { ConnectorsModule } from "../connectors/connectors.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { InfraDevicesModule } from "../devices/devices.module";
import { DiscoveryScanService } from "./discovery-scan.service";
import { DiscoveryController } from "./discovery.controller";
import { NetworkDiscoveryService } from "./network-discovery.service";
import { ProxmoxDiscoveryService } from "./proxmox-discovery.service";

@Module({
  imports: [PrismaModule, AuditModule, TraceAuthModule, ConnectorsModule, CredentialsModule, InfraDevicesModule],
  controllers: [DiscoveryController],
  providers: [NetworkDiscoveryService, ProxmoxDiscoveryService, DiscoveryScanService],
  exports: [NetworkDiscoveryService, ProxmoxDiscoveryService, DiscoveryScanService],
})
export class DiscoveryModule {}
