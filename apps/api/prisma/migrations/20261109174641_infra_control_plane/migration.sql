-- CreateEnum
CREATE TYPE "InfraDeviceCategory" AS ENUM ('PHYSICAL_SERVER', 'VIRTUAL_MACHINE', 'CONTAINER', 'ROUTER', 'FIREWALL', 'MANAGED_SWITCH', 'NAS', 'STORAGE_DEVICE', 'PRINTER', 'KVM', 'WORKSTATION', 'GENERIC_NETWORK_DEVICE');

-- CreateEnum
CREATE TYPE "InfraManagementProtocol" AS ENUM ('SSH', 'PROXMOX_API', 'SNMP_V3', 'VENDOR_API', 'WINDOWS_WINRM', 'DOCKER_API', 'NONE');

-- CreateEnum
CREATE TYPE "InfraEnrollmentStatus" AS ENUM ('DISCOVERED', 'PENDING', 'ENROLLED', 'ENROLLMENT_FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "InfraOnlineState" AS ENUM ('UNKNOWN', 'ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "InfraRelationshipKind" AS ENUM ('VERIFIED', 'INFERRED');

-- CreateEnum
CREATE TYPE "InfraRelationshipType" AS ENUM ('HOSTS', 'CONNECTED_TO', 'DEPENDS_ON');

-- CreateEnum
CREATE TYPE "InfraMetricKind" AS ENUM ('CPU_UTILIZATION', 'MEMORY_UTILIZATION', 'DISK_UTILIZATION', 'NETWORK_RX_THROUGHPUT', 'NETWORK_TX_THROUGHPUT', 'UPTIME_SECONDS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "InfraCommandStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED');

-- CreateTable
CREATE TABLE "infra_environments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infra_devices" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "InfraDeviceCategory" NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "operatingSystem" TEXT,
    "osVersion" TEXT,
    "ipAddresses" TEXT[],
    "macAddresses" TEXT[],
    "managementProtocols" "InfraManagementProtocol"[],
    "enrollmentStatus" "InfraEnrollmentStatus" NOT NULL DEFAULT 'DISCOVERED',
    "onlineState" "InfraOnlineState" NOT NULL DEFAULT 'UNKNOWN',
    "lastContactAt" TIMESTAMP(3),
    "notes" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parentDeviceId" TEXT,

    CONSTRAINT "infra_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infra_relationships" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "fromDeviceId" TEXT NOT NULL,
    "toDeviceId" TEXT NOT NULL,
    "type" "InfraRelationshipType" NOT NULL,
    "kind" "InfraRelationshipKind" NOT NULL DEFAULT 'INFERRED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infra_credentials" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "deviceId" TEXT,
    "label" TEXT NOT NULL,
    "protocol" "InfraManagementProtocol" NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "infra_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infra_metric_samples" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" "InfraMetricKind" NOT NULL,
    "label" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_metric_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infra_command_runs" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "deviceId" TEXT,
    "targetLabel" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "status" "InfraCommandStatus" NOT NULL DEFAULT 'PENDING',
    "exitCode" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "requestedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "timeoutMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_command_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infra_audit_log_entries" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "outcome" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trace_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "infra_environments_slug_key" ON "infra_environments"("slug");

-- CreateIndex
CREATE INDEX "infra_devices_environmentId_idx" ON "infra_devices"("environmentId");

-- CreateIndex
CREATE INDEX "infra_devices_parentDeviceId_idx" ON "infra_devices"("parentDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "infra_devices_environmentId_name_key" ON "infra_devices"("environmentId", "name");

-- CreateIndex
CREATE INDEX "infra_relationships_environmentId_idx" ON "infra_relationships"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "infra_relationships_fromDeviceId_toDeviceId_type_key" ON "infra_relationships"("fromDeviceId", "toDeviceId", "type");

-- CreateIndex
CREATE INDEX "infra_credentials_environmentId_idx" ON "infra_credentials"("environmentId");

-- CreateIndex
CREATE INDEX "infra_credentials_deviceId_idx" ON "infra_credentials"("deviceId");

-- CreateIndex
CREATE INDEX "infra_metric_samples_deviceId_kind_collectedAt_idx" ON "infra_metric_samples"("deviceId", "kind", "collectedAt");

-- CreateIndex
CREATE INDEX "infra_command_runs_environmentId_createdAt_idx" ON "infra_command_runs"("environmentId", "createdAt");

-- CreateIndex
CREATE INDEX "infra_command_runs_deviceId_idx" ON "infra_command_runs"("deviceId");

-- CreateIndex
CREATE INDEX "infra_audit_log_entries_environmentId_createdAt_idx" ON "infra_audit_log_entries"("environmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "trace_users_email_key" ON "trace_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credentialId_key" ON "webauthn_credentials"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "trace_sessions_tokenHash_key" ON "trace_sessions"("tokenHash");

-- AddForeignKey
ALTER TABLE "infra_devices" ADD CONSTRAINT "infra_devices_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "infra_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infra_devices" ADD CONSTRAINT "infra_devices_parentDeviceId_fkey" FOREIGN KEY ("parentDeviceId") REFERENCES "infra_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infra_relationships" ADD CONSTRAINT "infra_relationships_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "infra_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infra_relationships" ADD CONSTRAINT "infra_relationships_fromDeviceId_fkey" FOREIGN KEY ("fromDeviceId") REFERENCES "infra_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infra_relationships" ADD CONSTRAINT "infra_relationships_toDeviceId_fkey" FOREIGN KEY ("toDeviceId") REFERENCES "infra_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infra_credentials" ADD CONSTRAINT "infra_credentials_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "infra_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infra_credentials" ADD CONSTRAINT "infra_credentials_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "infra_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infra_metric_samples" ADD CONSTRAINT "infra_metric_samples_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "infra_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infra_command_runs" ADD CONSTRAINT "infra_command_runs_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "infra_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infra_command_runs" ADD CONSTRAINT "infra_command_runs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "infra_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infra_audit_log_entries" ADD CONSTRAINT "infra_audit_log_entries_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "infra_environments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "trace_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_sessions" ADD CONSTRAINT "trace_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "trace_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

