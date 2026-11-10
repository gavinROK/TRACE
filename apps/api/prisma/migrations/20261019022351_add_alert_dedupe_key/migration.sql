-- AlterTable
ALTER TABLE "security_alerts" ADD COLUMN     "dedupeKey" TEXT;

-- CreateIndex
CREATE INDEX "security_alerts_organizationId_type_dedupeKey_status_idx" ON "security_alerts"("organizationId", "type", "dedupeKey", "status");

