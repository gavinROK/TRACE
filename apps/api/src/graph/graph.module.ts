import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GraphController } from "./graph.controller";
import { GraphService } from "./graph.service";

@Module({
  imports: [AuthModule],
  controllers: [GraphController],
  providers: [GraphService],
})
export class GraphModule {}
