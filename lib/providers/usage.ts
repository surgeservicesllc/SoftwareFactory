import type { ProviderId, ProviderUsage } from "@/lib/providers/types";

/**
 * Declared reference prices used only to estimate the cost of a run.
 *
 * These are list prices recorded from provider documentation on the date
 * below. They are not billing truth, they are not contract prices, and they
 * are labelled as estimates everywhere they surface. An organization may
 * override or add a price through `public.provider_model_configurations`.
 */
export const MODEL_PRICE_TABLE_RECORDED_ON = "2026-06-24";

export interface ModelPrice {
  readonly provider: ProviderId;
  readonly model: string;
  /** US dollars per million input tokens. */
  readonly inputPerMillionUsd: number;
  /** US dollars per million output tokens. */
  readonly outputPerMillionUsd: number;
}

/**
 * Only prices this repository can cite are declared. OpenAI models are
 * deliberately absent: no verified price list is available to this codebase,
 * and inventing one would make the Reports surface lie. Owners supply OpenAI
 * prices through the model configuration table, and until they do the cost
 * column reads "Not declared".
 */
export const DECLARED_MODEL_PRICES: readonly ModelPrice[] = Object.freeze([
  Object.freeze({ provider: "anthropic", model: "claude-opus-5", inputPerMillionUsd: 5, outputPerMillionUsd: 25 }),
  Object.freeze({ provider: "anthropic", model: "claude-opus-4-8", inputPerMillionUsd: 5, outputPerMillionUsd: 25 }),
  Object.freeze({ provider: "anthropic", model: "claude-sonnet-5", inputPerMillionUsd: 3, outputPerMillionUsd: 15 }),
  Object.freeze({ provider: "anthropic", model: "claude-haiku-4-5", inputPerMillionUsd: 1, outputPerMillionUsd: 5 }),
]);

export function findDeclaredModelPrice(
  provider: ProviderId,
  model: string,
): ModelPrice | null {
  return (
    DECLARED_MODEL_PRICES.find(
      (price) => price.provider === provider && price.model === model,
    ) ?? null
  );
}

const MICROS_PER_USD = 1_000_000;
const TOKENS_PER_PRICE_UNIT = 1_000_000;

/**
 * Estimate the cost of a run in micro-USD. Returns null when no price is
 * declared, which the UI must render as unknown rather than as zero.
 */
export function estimateCostMicros(
  provider: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
  priceOverride?: ModelPrice | null,
): number | null {
  const price = priceOverride ?? findDeclaredModelPrice(provider, model);
  if (!price) return null;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  if (inputTokens < 0 || outputTokens < 0) return null;

  const inputMicros =
    (inputTokens / TOKENS_PER_PRICE_UNIT) * price.inputPerMillionUsd * MICROS_PER_USD;
  const outputMicros =
    (outputTokens / TOKENS_PER_PRICE_UNIT) * price.outputPerMillionUsd * MICROS_PER_USD;

  return Math.round(inputMicros + outputMicros);
}

export function buildUsage(
  provider: ProviderId,
  model: string,
  tokens: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens?: number | null;
  },
  priceOverride?: ModelPrice | null,
): ProviderUsage {
  const inputTokens = Math.max(0, Math.trunc(tokens.inputTokens));
  const outputTokens = Math.max(0, Math.trunc(tokens.outputTokens));

  return Object.freeze({
    inputTokens,
    outputTokens,
    cachedInputTokens:
      typeof tokens.cachedInputTokens === "number"
        ? Math.max(0, Math.trunc(tokens.cachedInputTokens))
        : null,
    estimatedCostMicros: estimateCostMicros(
      provider,
      model,
      inputTokens,
      outputTokens,
      priceOverride,
    ),
  });
}

/** Format micro-USD for display. Returns the truthful label when unknown. */
export function formatEstimatedCost(estimatedCostMicros: number | null): string {
  if (estimatedCostMicros === null) return "Not declared";
  const usd = estimatedCostMicros / MICROS_PER_USD;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}
