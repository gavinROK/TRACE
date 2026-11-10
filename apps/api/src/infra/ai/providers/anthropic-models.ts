import type { AiModelInfo } from "./ai-provider.interface";

/**
 * A maintained fallback, used only when the live Models API
 * (GET /v1/models, called from anthropic-provider.service.ts) is
 * unreachable — no API key configured yet, a network error, etc. The
 * live list is always preferred; this exists so model selection still
 * works offline and so cost estimates have somewhere to look up a price
 * even when the live call fails mid-conversation.
 *
 * Prices are base (non-cached) input/output cost per million tokens,
 * confirmed against https://platform.claude.com/docs/en/about-claude/pricing
 * on 2026-11-10. Verify there before trusting an old copy of this file —
 * Anthropic can and does change pricing and introduce new models; this
 * list is deliberately small and only as current as its last edit.
 */
export const ANTHROPIC_FALLBACK_MODELS: AiModelInfo[] = [
  {
    id: "claude-opus-5",
    displayName: "Claude Opus 5",
    pricePerMillionInputTokens: 5,
    pricePerMillionOutputTokens: 25,
  },
  {
    id: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    pricePerMillionInputTokens: 2,
    pricePerMillionOutputTokens: 10,
  },
  {
    id: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    pricePerMillionInputTokens: 1,
    pricePerMillionOutputTokens: 5,
  },
];

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

/** Looks up a price for cost estimation. Returns undefined (never 0) for
 * a model this list doesn't know about — callers must render that as
 * "cost unknown," not as free. The live Models API doesn't return
 * pricing at all (confirmed: its ModelInfo has no price fields), so this
 * lookup is the only source of estimated cost regardless of which list
 * populated the model picker. */
export function findFallbackModelPricing(modelId: string): AiModelInfo | undefined {
  return ANTHROPIC_FALLBACK_MODELS.find((m) => m.id === modelId);
}
