import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { IsString, Matches, MinLength } from "class-validator";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { NetworkDiscoveryService } from "./network-discovery.service";
import { ProxmoxDiscoveryService } from "./proxmox-discovery.service";

class PingDto {
  @IsString()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}$/)
  ip!: string;
}

class NmapSweepDto {
  @IsString()
  @MinLength(1)
  cidr!: string;
}

@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/discovery")
export class DiscoveryController {
  constructor(
    private readonly networkDiscovery: NetworkDiscoveryService,
    private readonly proxmoxDiscovery: ProxmoxDiscoveryService,
  ) {}

  @Get("interfaces")
  interfaces() {
    return this.networkDiscovery.listLocalInterfaces();
  }

  @Get("arp")
  arp() {
    return this.networkDiscovery.listArpNeighbors();
  }

  @Post("ping")
  async ping(@Body() dto: PingDto) {
    return { ip: dto.ip, reachable: await this.networkDiscovery.checkReachability(dto.ip) };
  }

  @Post("nmap")
  async nmap(@Body() dto: NmapSweepDto) {
    return { cidr: dto.cidr, hosts: await this.networkDiscovery.runNmapPingSweep(dto.cidr) };
  }

  @Post("proxmox/:hypervisorDeviceId")
  proxmox(
    @Req() req: InfraAuthenticatedRequest,
    @Param("environmentId") environmentId: string,
    @Param("hypervisorDeviceId") hypervisorDeviceId: string,
  ) {
    return this.proxmoxDiscovery.discoverFromHypervisor(environmentId, req.actor, hypervisorDeviceId);
  }
}
