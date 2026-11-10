import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { InfraAuthenticatedRequest, TraceAccessGuard } from "../auth/trace-access.guard";
import { CommandExecutionService } from "./command-execution.service";
import { ExecCommandDto, ExecGroupCommandDto } from "./dto/exec-command.dto";

@UseGuards(TraceAccessGuard)
@Controller("infra/environments/:environmentId/console")
export class ConsoleController {
  constructor(private readonly commandExecution: CommandExecutionService) {}

  @Post("exec")
  exec(@Req() req: InfraAuthenticatedRequest, @Param("environmentId") environmentId: string, @Body() dto: ExecCommandDto) {
    return this.commandExecution.executeOnDevice(environmentId, req.actor, dto.deviceName, dto.command, dto.timeoutMs);
  }

  @Post("exec-group")
  execGroup(@Req() req: InfraAuthenticatedRequest, @Param("environmentId") environmentId: string, @Body() dto: ExecGroupCommandDto) {
    if (dto.deviceNames.length > 1 && !dto.confirm) {
      throw new BadRequestException(
        `Running a command against ${dto.deviceNames.length} devices requires confirm: true`,
      );
    }
    return this.commandExecution.executeOnGroup(
      environmentId,
      req.actor,
      dto.deviceNames,
      dto.command,
      dto.timeoutMs,
      dto.concurrency,
    );
  }

  @Get("runs")
  listRuns(@Param("environmentId") environmentId: string, @Query("limit") limit?: string) {
    return this.commandExecution.listRuns(environmentId, limit ? Number(limit) : undefined);
  }

  @Get("runs/:runId")
  getRun(@Param("environmentId") environmentId: string, @Param("runId") runId: string) {
    return this.commandExecution.getRun(environmentId, runId);
  }

  @Post("runs/:runId/cancel")
  async cancel(@Param("runId") runId: string) {
    const cancelled = await this.commandExecution.cancel(runId);
    return { cancelled };
  }
}
