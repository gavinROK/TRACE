import { IsIn, IsObject, IsOptional } from "class-validator";
import type { DiagnosticName } from "../../connectors/connector.types";

export const DIAGNOSTIC_NAMES: DiagnosticName[] = [
  "os_info",
  "cpu_memory_disk",
  "network_interfaces",
  "service_status",
  "system_logs",
  "process_list",
  "package_inventory",
  "firewall_rules",
  "filesystem_info",
  "security_posture",
];

export class RunDiagnosticDto {
  @IsIn(DIAGNOSTIC_NAMES)
  name!: DiagnosticName;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
