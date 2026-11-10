-- AlterTable
ALTER TABLE "infra_devices" ADD COLUMN     "discoverySource" TEXT,
ADD COLUMN     "managementPort" INTEGER,
ADD COLUMN     "tags" TEXT[];
