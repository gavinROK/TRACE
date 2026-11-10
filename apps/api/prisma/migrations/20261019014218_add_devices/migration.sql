-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('LAPTOP', 'DESKTOP', 'MOBILE', 'SERVER', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceEnrollmentType" AS ENUM ('MANUAL', 'SIMULATED', 'AGENT');

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "operatingSystem" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "serialNumber" TEXT,
    "enrollmentType" "DeviceEnrollmentType" NOT NULL DEFAULT 'MANUAL',
    "diskEncrypted" BOOLEAN,
    "firewallEnabled" BOOLEAN,
    "osUpToDate" BOOLEAN,
    "screenLockEnabled" BOOLEAN,
    "lastCheckInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "devices_organizationId_idx" ON "devices"("organizationId");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "developers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

