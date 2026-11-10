import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { InfraDevicesModule } from "../devices/devices.module";
import { TopologyController } from "./topology.controller";
import { TopologyService } from "./topology.service";

@Module({
  imports: [PrismaModule, TraceAuthModule, InfraDevicesModule],
  controllers: [TopologyController],
  providers: [TopologyService],
})
export class TopologyModule {}
