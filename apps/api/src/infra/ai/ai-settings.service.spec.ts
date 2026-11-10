import { AiProviderKind } from "@prisma/client";
import { AiSettingsService } from "./ai-settings.service";
import { ANTHROPIC_FALLBACK_MODELS } from "./providers/anthropic-models";

describe("AiSettingsService", () => {
  const prisma = {
    aiProviderSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const masterKeyStore = { getKey: jest.fn().mockResolvedValue(Buffer.alloc(32, 7)) };
  const anthropicProvider = { listModels: jest.fn() };
  const service = new AiSettingsService(prisma as never, masterKeyStore as never, anthropicProvider as never);

  beforeEach(() => jest.clearAllMocks());

  it("reports not configured when no row exists", async () => {
    prisma.aiProviderSetting.findUnique.mockResolvedValue(null);
    const status = await service.getStatus(AiProviderKind.ANTHROPIC);
    expect(status.configured).toBe(false);
    expect(status.selectedModel).toBeNull();
  });

  it("saveApiKey encrypts the key before storing it — the plaintext never appears in the Prisma write", async () => {
    prisma.aiProviderSetting.upsert.mockResolvedValue({});
    prisma.aiProviderSetting.findUnique.mockResolvedValue({ updatedAt: new Date(), selectedModel: null });

    await service.saveApiKey(AiProviderKind.ANTHROPIC, "sk-ant-super-secret-key-value");

    const writeArgs = prisma.aiProviderSetting.upsert.mock.calls[0][0];
    const serializedWrite = JSON.stringify(writeArgs);
    expect(serializedWrite).not.toContain("sk-ant-super-secret-key-value");
    expect(writeArgs.create.encryptedApiKey).toBeTruthy();
    expect(writeArgs.create.iv).toBeTruthy();
    expect(writeArgs.create.authTag).toBeTruthy();
  });

  it("getStatus never returns the API key itself, only metadata", async () => {
    prisma.aiProviderSetting.findUnique.mockResolvedValue({
      updatedAt: new Date("2026-01-01"),
      selectedModel: "claude-sonnet-5",
      encryptedApiKey: "ciphertext",
      iv: "iv",
      authTag: "tag",
    });
    const status = await service.getStatus(AiProviderKind.ANTHROPIC);
    expect(status).not.toHaveProperty("encryptedApiKey");
    expect(status).not.toHaveProperty("apiKey");
    expect(status.selectedModel).toBe("claude-sonnet-5");
  });

  it("getApiKey decrypts a round-tripped payload using the real cipher", async () => {
    // Encrypt for real via the service's own saveApiKey, then capture
    // exactly what was "stored" and feed it back through getApiKey —
    // exercises the real AES-256-GCM round trip, not a mock.
    let stored: { encryptedApiKey: string; iv: string; authTag: string } | undefined;
    prisma.aiProviderSetting.upsert.mockImplementation(({ create }: { create: typeof stored }) => {
      stored = create;
      return Promise.resolve({});
    });
    prisma.aiProviderSetting.findUnique.mockImplementation(() => Promise.resolve(stored ? { ...stored, updatedAt: new Date(), selectedModel: null } : null));

    await service.saveApiKey(AiProviderKind.ANTHROPIC, "my-real-api-key-12345");
    const apiKey = await service.getApiKey(AiProviderKind.ANTHROPIC);

    expect(apiKey).toBe("my-real-api-key-12345");
  });

  it("clearApiKey deletes the row", async () => {
    await service.clearApiKey(AiProviderKind.ANTHROPIC);
    expect(prisma.aiProviderSetting.deleteMany).toHaveBeenCalledWith({ where: { provider: AiProviderKind.ANTHROPIC } });
  });

  it("listAvailableModels falls back to the maintained list when no API key is configured", async () => {
    prisma.aiProviderSetting.findUnique.mockResolvedValue(null);
    const models = await service.listAvailableModels(AiProviderKind.ANTHROPIC);
    expect(models).toEqual(ANTHROPIC_FALLBACK_MODELS);
    expect(anthropicProvider.listModels).not.toHaveBeenCalled();
  });

  it("listAvailableModels returns an empty list for a not-yet-implemented provider", async () => {
    const models = await service.listAvailableModels(AiProviderKind.OPENAI);
    expect(models).toEqual([]);
  });
});
