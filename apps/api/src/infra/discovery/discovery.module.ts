import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { ConnectorsModule } from "../connectors/connectors.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { DiscoveryController } from "./discovery.controller";
import { NetworkDiscoveryService } from "./network-discovery.service";
import { ProxmoxDiscoveryService } from "./proxmox-discovery.service";

@Module({
  imports: [PrismaModule, AuditModule, TraceAuthModule, ConnectorsModule, CredentialsModule],
  controllers: [DiscoveryController],
  providers: [NetworkDiscoveryService, ProxmoxDiscoveryService],
  exports: [NetworkDiscoveryService, ProxmoxDiscoveryService],
})
export class DiscoveryModule {}
