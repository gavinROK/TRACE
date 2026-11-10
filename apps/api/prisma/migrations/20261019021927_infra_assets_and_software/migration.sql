-- CreateEnum
CREATE TYPE "SoftwareInventorySource" AS ENUM ('MANUAL', 'CSV_IMPORT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeviceType" ADD VALUE 'SWITCH';
ALTER TYPE "DeviceType" ADD VALUE 'ROUTER';
ALTER TYPE "DeviceType" ADD VALUE 'ACCESS_POINT';
ALTER TYPE "DeviceType" ADD VALUE 'VIRTUAL_MACHINE';

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "departmentId" TEXT;

-- CreateTable
CREATE TABLE "software_installations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "publisher" TEXT,
    "installedAt" TIMESTAMP(3),
    "source" "SoftwareInventorySource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "software_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "software_installations_organizationId_idx" ON "software_installations"("organizationId");

-- CreateIndex
CREATE INDEX "software_installations_deviceId_idx" ON "software_installations"("deviceId");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_installations" ADD CONSTRAINT "software_installations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_installations" ADD CONSTRAINT "software_installations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

