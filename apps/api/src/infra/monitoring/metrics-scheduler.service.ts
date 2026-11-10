import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { DevicePollingService } from "./device-polling.service";

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Polls every enrolled device on a fixed interval so the dashboard has
 * recent health/metrics without the operator having to click "check
 * health" on each one. Only devices with enrollmentStatus ENROLLED are
 * polled automatically — DISCOVERED/PENDING devices have no verified
 * credential yet, so polling them would just generate repeated
 * connection failures (see docs/ARCHITECTURE.md). One device's failure
 * never stops the rest of the batch from being polled.
 */
@Injectable()
export class MetricsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(MetricsSchedulerService.name);
  private polling = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DevicePollingService) private readonly devicePolling: DevicePollingService,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      `Metrics polling interval: ${process.env.TRACE_METRICS_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS}ms`,
    );
  }

  @Interval(Number(process.env.TRACE_METRICS_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS))
  async pollAllEnrolledDevices(): Promise<void> {
    if (this.polling) {
      this.logger.warn("Skipping this polling tick — the previous one is still running");
      return;
    }
    this.polling = true;
    try {
      const devices = await this.prisma.infraDevice.findMany({
        where: { enrollmentStatus: "ENROLLED" },
        select: { id: true, environmentId: true, name: true },
      });
      for (const device of devices) {
        try {
          await this.devicePolling.pollDevice(device.environmentId, device.id);
        } catch (error) {
          this.logger.warn(`Polling failed for device "${device.name}": ${error instanceof Error ? error.message : error}`);
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
