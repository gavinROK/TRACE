import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface AuditEntryInput {
  environmentId?: string;
  actor: string;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome: "success" | "denied" | "error";
  detail?: Record<string, unknown>;
}

/**
 * The general security/audit trail (PRODUCT_SPEC.md section 15) — every
 * credential change, enrollment, discovery run, and performAction() call
 * writes one row here, in addition to (for console commands)
 * InfraCommandRun's richer per-command record. `detail` must never
 * contain a secret — callers pass only metadata (labels, protocols,
 * counts), never credential payloads or command output.
 */
@Injectable()
export class AuditLogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(entry: AuditEntryInput): Promise<void> {
    await this.prisma.infraAuditLogEntry.create({
      data: {
        environmentId: entry.environmentId,
        actor: entry.actor,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        outcome: entry.outcome,
        detail: entry.detail as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async listForEnvironment(environmentId: string, limit = 200) {
    return this.prisma.infraAuditLogEntry.findMany({
      where: { environmentId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
