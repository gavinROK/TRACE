import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ApiUsageSpikeRule } from "./rules/api-usage-spike.rule";
import { DeviceDataQualityRule } from "./rules/device-data-quality.rule";
import { DevicePostureRule } from "./rules/device-posture.rule";
import { ElevatedApiErrorRateRule } from "./rules/elevated-api-error-rate.rule";
import { UnusualCommitVolumeRule } from "./rules/unusual-commit-volume.rule";
import { SecurityAlertsController } from "./security-alerts.controller";
import { SecurityDetectionService } from "./security-detection.service";
import { SECURITY_RULES } from "./security-rule";

@Module({
  imports: [AuthModule],
  controllers: [SecurityAlertsController],
  providers: [
    ApiUsageSpikeRule,
    ElevatedApiErrorRateRule,
    UnusualCommitVolumeRule,
    DevicePostureRule,
    DeviceDataQualityRule,
    SecurityDetectionService,
    {
      provide: SECURITY_RULES,
      useFactory: (
        apiUsageSpike: ApiUsageSpikeRule,
        elevatedErrorRate: ElevatedApiErrorRateRule,
        unusualCommitVolume: UnusualCommitVolumeRule,
        devicePosture: DevicePostureRule,
        deviceDataQuality: DeviceDataQualityRule,
      ) => [apiUsageSpike, elevatedErrorRate, unusualCommitVolume, devicePosture, deviceDataQuality],
      inject: [
        ApiUsageSpikeRule,
        ElevatedApiErrorRateRule,
        UnusualCommitVolumeRule,
        DevicePostureRule,
        DeviceDataQualityRule,
      ],
    },
  ],
})
export class SecurityModule {}
