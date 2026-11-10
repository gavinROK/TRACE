-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('ANTHROPIC', 'OPENAI', 'LOCAL');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "AiActionClassification" AS ENUM ('READ_ONLY', 'ADMINISTRATIVE', 'DESTRUCTIVE');

-- CreateEnum
CREATE TYPE "AiPendingActionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ai_provider_settings" (
    "id" TEXT NOT NULL,
    "provider" "AiProviderKind" NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "selectedModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "title" TEXT,
    "deviceContextId" TEXT,
    "deviceContextName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolResults" JSONB,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_pending_actions" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolInput" JSONB NOT NULL,
    "classification" "AiActionClassification" NOT NULL,
    "status" "AiPendingActionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_settings_provider_key" ON "ai_provider_settings"("provider");

-- CreateIndex
CREATE INDEX "ai_conversations_environmentId_actor_idx" ON "ai_conversations"("environmentId", "actor");

-- CreateIndex
CREATE INDEX "ai_messages_conversationId_createdAt_idx" ON "ai_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_pending_actions_conversationId_idx" ON "ai_pending_actions"("conversationId");

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "infra_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
