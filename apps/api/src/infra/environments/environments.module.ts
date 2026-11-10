import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { EnvironmentsController } from "./environments.controller";
import { EnvironmentsService } from "./environments.service";

@Module({
  imports: [PrismaModule, AuditModule, TraceAuthModule],
  controllers: [EnvironmentsController],
  providers: [EnvironmentsService],
  exports: [EnvironmentsService],
})
export class EnvironmentsModule {}
