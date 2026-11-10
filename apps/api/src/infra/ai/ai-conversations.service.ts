import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AiMessageRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface StartConversationInput {
  environmentId: string;
  actor: string;
  deviceContextId?: string;
  deviceContextName?: string;
}

export interface AppendMessageInput {
  role: AiMessageRole;
  content: string;
  toolCalls?: unknown;
  toolResults?: unknown;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

/**
 * Owns AiConversation/AiMessage. Every method that touches an existing
 * conversation checks `actor` ownership first — PRODUCT_SPEC v0.3
 * section 8/10: conversations are private to the operator who started
 * them, same as every other owned resource in TRACE. Never stores a
 * credential or raw API key; callers (ai-chat.service.ts) redact tool
 * payloads before passing them here — this service does not redact a
 * second time, it trusts the caller the same way AuditLogService trusts
 * its callers never to pass a secret in `detail`.
 */
@Injectable()
export class AiConversationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async start(input: StartConversationInput) {
    return this.prisma.aiConversation.create({
      data: {
        environmentId: input.environmentId,
        actor: input.actor,
        deviceContextId: input.deviceContextId,
        deviceContextName: input.deviceContextName,
      },
    });
  }

  async list(environmentId: string, actor: string) {
    return this.prisma.aiConversation.findMany({
      where: { environmentId, actor },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        deviceContextId: true,
        deviceContextName: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
  }

  async getWithMessages(environmentId: string, actor: string, conversationId: string) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, environmentId, actor },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");
    return conversation;
  }

  /** Throws if the conversation doesn't belong to `actor` — the one
   * check every mutation below relies on before touching a row. */
  async assertOwned(environmentId: string, actor: string, conversationId: string): Promise<void> {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, environmentId },
      select: { actor: true },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");
    if (conversation.actor !== actor) throw new ForbiddenException("This conversation belongs to a different user");
  }

  async appendMessage(conversationId: string, message: AppendMessageInput) {
    const [saved] = await this.prisma.$transaction([
      this.prisma.aiMessage.create({
        data: {
          conversationId,
          role: message.role,
          content: message.content,
          toolCalls: message.toolCalls as never,
          toolResults: message.toolResults as never,
          model: message.model,
          inputTokens: message.inputTokens,
          outputTokens: message.outputTokens,
          estimatedCostUsd: message.estimatedCostUsd,
        },
      }),
      this.prisma.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
    ]);
    return saved;
  }

  async setTitleIfUnset(conversationId: string, title: string): Promise<void> {
    await this.prisma.aiConversation.updateMany({
      where: { id: conversationId, title: null },
      data: { title: title.slice(0, 120) },
    });
  }

  async rename(environmentId: string, actor: string, conversationId: string, title: string): Promise<void> {
    await this.assertOwned(environmentId, actor, conversationId);
    await this.prisma.aiConversation.update({ where: { id: conversationId }, data: { title: title.slice(0, 120) } });
  }

  /** Cascades to AiMessage/AiPendingAction via the schema's onDelete:
   * Cascade — no separate cleanup needed. */
  async remove(environmentId: string, actor: string, conversationId: string): Promise<void> {
    await this.assertOwned(environmentId, actor, conversationId);
    await this.prisma.aiConversation.delete({ where: { id: conversationId } });
  }
}
