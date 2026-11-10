import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { ConnectorsModule } from "../connectors/connectors.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { InfraDevicesModule } from "../devices/devices.module";
import { CommandExecutionService } from "./command-execution.service";
import { ConsoleController } from "./console.controller";

@Module({
  imports: [PrismaModule, AuditModule, TraceAuthModule, ConnectorsModule, CredentialsModule, InfraDevicesModule],
  controllers: [ConsoleController],
  providers: [CommandExecutionService],
  exports: [CommandExecutionService],
})
export class ConsoleModule {}
