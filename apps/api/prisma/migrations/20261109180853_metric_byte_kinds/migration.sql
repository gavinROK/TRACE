-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InfraMetricKind" ADD VALUE 'MEMORY_USED_BYTES';
ALTER TYPE "InfraMetricKind" ADD VALUE 'MEMORY_TOTAL_BYTES';
ALTER TYPE "InfraMetricKind" ADD VALUE 'DISK_USED_BYTES';
ALTER TYPE "InfraMetricKind" ADD VALUE 'DISK_TOTAL_BYTES';

