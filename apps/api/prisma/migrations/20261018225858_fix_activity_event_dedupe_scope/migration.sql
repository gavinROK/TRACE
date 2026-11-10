-- DropIndex
DROP INDEX "activity_events_organizationId_type_externalId_key";

-- CreateIndex
CREATE UNIQUE INDEX "activity_events_organizationId_repositoryId_type_externalId_key" ON "activity_events"("organizationId", "repositoryId", "type", "externalId");

