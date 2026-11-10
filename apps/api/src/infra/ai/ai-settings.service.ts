import { Injectable } from "@nestjs/common";
import { AiProviderKind } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { MasterKeyStore } from "../credentials/master-key.store";
import { decryptSecret, encryptSecret } from "../credentials/secret-cipher";
import { AnthropicProviderService } from "./providers/anthropic-provider.service";
import { ANTHROPIC_FALLBACK_MODELS, DEFAULT_ANTHROPIC_MODEL } from "./providers/anthropic-models";
import type { AiModelInfo } from "./providers/ai-provider.interface";

export interface AiSettingsStatus {
  configured: boolean;
  provider: AiProviderKind;
  selectedModel: string | null;
  /** Never the key itself — only whether one exists, and when it was
   * last saved, so the settings screen can say "configured on <date>"
   * without the backend ever re-serving the secret. */
  updatedAt: string | null;
}

/**
 * Owns the one `AiProviderSetting` row per provider. Same encryption
 * construction as InfraCredential — AES-256-GCM via the identical
 * secret-cipher.ts + MasterKeyStore this repo already has, not a second
 * implementation. No method here returns a decrypted key; `getApiKey`
 * is only ever called from ai-chat.service.ts, immediately before a
 * provider call, same shape as CredentialsService.getDecryptedForDevice.
 */
@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterKeyStore: MasterKeyStore,
    private readonly anthropicProvider: AnthropicProviderService,
  ) {}

  async getStatus(provider: AiProviderKind = AiProviderKind.ANTHROPIC): Promise<AiSettingsStatus> {
    const row = await this.prisma.aiProviderSetting.findUnique({ where: { provider } });
    return {
      configured: Boolean(row),
      provider,
      selectedModel: row?.selectedModel ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async saveApiKey(provider: AiProviderKind, apiKey: string): Promise<AiSettingsStatus> {
    const masterKey = await this.masterKeyStore.getKey();
    const encrypted = encryptSecret({ apiKey }, masterKey);
    await this.prisma.aiProviderSetting.upsert({
      where: { provider },
      create: { provider, encryptedApiKey: encrypted.encryptedPayload, iv: encrypted.iv, authTag: encrypted.authTag },
      update: { encryptedApiKey: encrypted.encryptedPayload, iv: encrypted.iv, authTag: encrypted.authTag },
    });
    return this.getStatus(provider);
  }

  async clearApiKey(provider: AiProviderKind): Promise<void> {
    await this.prisma.aiProviderSetting.deleteMany({ where: { provider } });
  }

  async setSelectedModel(provider: AiProviderKind, modelId: string): Promise<AiSettingsStatus> {
    await this.prisma.aiProviderSetting.update({ where: { provider }, data: { selectedModel: modelId } });
    return this.getStatus(provider);
  }

  /** Decrypted just-in-time for one provider call — never returned from
   * a controller (see ai.controller.ts, which only ever calls getStatus
   * for anything client-facing). */
  async getApiKey(provider: AiProviderKind = AiProviderKind.ANTHROPIC): Promise<string | undefined> {
    const row = await this.prisma.aiProviderSetting.findUnique({ where: { provider } });
    if (!row) return undefined;
    const masterKey = await this.masterKeyStore.getKey();
    const payload = decryptSecret({ encryptedPayload: row.encryptedApiKey, iv: row.iv, authTag: row.authTag }, masterKey);
    return payload.apiKey as string;
  }

  async getSelectedModelOrDefault(provider: AiProviderKind = AiProviderKind.ANTHROPIC): Promise<string> {
    const row = await this.prisma.aiProviderSetting.findUnique({ where: { provider } });
    return row?.selectedModel ?? DEFAULT_ANTHROPIC_MODEL;
  }

  /** Returns the live model list when an API key is configured and
   * reachable, otherwise the maintained fallback — never blocks the
   * settings screen on a network call having to succeed. */
  async listAvailableModels(provider: AiProviderKind = AiProviderKind.ANTHROPIC): Promise<AiModelInfo[]> {
    if (provider !== AiProviderKind.ANTHROPIC) return []; // OPENAI/LOCAL not implemented yet
    const apiKey = await this.getApiKey(provider);
    if (!apiKey) return ANTHROPIC_FALLBACK_MODELS;
    return this.anthropicProvider.listModels(apiKey);
  }
}
