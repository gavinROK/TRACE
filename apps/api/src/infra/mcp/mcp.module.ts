import { Module } from "@nestjs/common";
import { TraceAuthModule } from "../auth/trace-auth.module";
import { McpStatusController } from "./mcp-status.controller";

@Module({
  imports: [TraceAuthModule],
  controllers: [McpStatusController],
})
export class McpModule {}
