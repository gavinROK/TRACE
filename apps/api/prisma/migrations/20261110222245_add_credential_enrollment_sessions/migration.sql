-- CreateEnum
CREATE TYPE "CredentialEnrollmentStatus" AS ENUM ('AUTHORIZED', 'COMPLETED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "credential_enrollment_sessions" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "protocol" "InfraManagementProtocol" NOT NULL,
    "label" TEXT,
    "status" "CredentialEnrollmentStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "credentialId" TEXT,

    CONSTRAINT "credential_enrollment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credential_enrollment_sessions_credentialId_key" ON "credential_enrollment_sessions"("credentialId");

-- CreateIndex
CREATE INDEX "credential_enrollment_sessions_environmentId_deviceId_idx" ON "credential_enrollment_sessions"("environmentId", "deviceId");

-- CreateIndex
CREATE INDEX "credential_enrollment_sessions_deviceId_status_idx" ON "credential_enrollment_sessions"("deviceId", "status");

-- AddForeignKey
ALTER TABLE "credential_enrollment_sessions" ADD CONSTRAINT "credential_enrollment_sessions_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "infra_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_enrollment_sessions" ADD CONSTRAINT "credential_enrollment_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "infra_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_enrollment_sessions" ADD CONSTRAINT "credential_enrollment_sessions_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "infra_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
