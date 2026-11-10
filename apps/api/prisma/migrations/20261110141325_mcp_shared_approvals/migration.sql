-- DropForeignKey
ALTER TABLE "ai_pending_actions" DROP CONSTRAINT "ai_pending_actions_conversationId_fkey";

-- AlterTable
ALTER TABLE "ai_pending_actions" ALTER COLUMN "conversationId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ai_pending_actions_environmentId_status_idx" ON "ai_pending_actions"("environmentId", "status");

-- AddForeignKey
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
