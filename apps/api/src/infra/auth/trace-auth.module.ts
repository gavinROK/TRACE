import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { TraceAccessGuard } from "./trace-access.guard";
import { TraceAuthController } from "./trace-auth.controller";
import { TraceAuthService } from "./trace-auth.service";
import { WebauthnService } from "./webauthn.service";

@Module({
  imports: [PrismaModule],
  controllers: [TraceAuthController],
  providers: [TraceAuthService, WebauthnService, TraceAccessGuard],
  exports: [TraceAuthService, TraceAccessGuard],
})
export class TraceAuthModule {}
