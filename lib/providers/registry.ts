import "server-only";

import { AnthropicProviderAdapter } from "@/lib/providers/anthropic-adapter";
import { resolveProviderConfiguration } from "@/lib/providers/config";
import { OpenAIProviderAdapter } from "@/lib/providers/openai-adapter";
import type { ProviderAvailability } from "@/lib/providers/routing";
import { findDeclaredModelPrice } from "@/lib/providers/usage";
import {
  PROVIDER_IDS,
  type ProviderAdapter,
  type ProviderHealth,
  type ProviderId,
} from "@/lib/providers/types";

/**
 * Adapter construction and the availability snapshot the router consumes.
 *
 * Adapters are constructed per call rather than cached: configuration is read
 * from the environment, and a cached adapter would keep serving a stale
 * credential or model selection after the deployment changed.
 */

export function getProviderAdapter(provider: ProviderId): ProviderAdapter {
  const configuration = resolveProviderConfiguration(provider);
  switch (provider) {
    case "anthropic":
      return new AnthropicProviderAdapter(configuration);
    case "openai":
      return new OpenAIProviderAdapter(configuration);
  }
}

export function listProviderAdapters(): readonly ProviderAdapter[] {
  return Object.freeze(PROVIDER_IDS.map((provider) => getProviderAdapter(provider)));
}

/** Live health for every provider. Never throws; a probe failure is a state. */
export async function snapshotProviderHealth(): Promise<readonly ProviderHealth[]> {
  const adapters = listProviderAdapters();
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        return await adapter.checkHealth();
      } catch {
        return Object.freeze({
          provider: adapter.id,
          state: "error" as const,
          checkedAt: new Date().toISOString(),
          detail: "The provider health probe failed.",
          latencyMs: null,
          defaultModel: adapter.defaultModel,
        });
      }
    }),
  );
  return Object.freeze(results);
}

/** Observed run history for one provider, read from persisted agent runs. */
export interface ProviderObservedMetrics {
  readonly recentSuccessRate: number | null;
  readonly medianLatencyMs: number | null;
}

export interface AvailabilityOptions {
  /** Models the organization has enabled, per provider. */
  readonly enabledModelsByProvider: Partial<Record<ProviderId, readonly string[]>>;
  readonly metricsByProvider?: Partial<Record<ProviderId, ProviderObservedMetrics>>;
  /** Pre-computed health, so callers can probe once and route many times. */
  readonly health?: readonly ProviderHealth[];
}

/**
 * Blended declared price used only as a routing signal: a simple average of
 * declared input and output prices for the model that would be used. Null when
 * no price is declared, which scores as neutral rather than as free.
 */
function blendedDeclaredCost(provider: ProviderId, model: string | null): number | null {
  if (!model) return null;
  const price = findDeclaredModelPrice(provider, model);
  if (!price) return null;
  return (price.inputPerMillionUsd + price.outputPerMillionUsd) / 2;
}

export async function buildProviderAvailability(
  options: AvailabilityOptions,
): Promise<readonly ProviderAvailability[]> {
  const adapters = listProviderAdapters();
  const health = options.health ?? (await snapshotProviderHealth());
  const healthByProvider = new Map(health.map((entry) => [entry.provider, entry]));

  return Object.freeze(
    adapters.map((adapter) => {
      const providerHealth = healthByProvider.get(adapter.id);
      const configuredModels = options.enabledModelsByProvider[adapter.id] ?? [];
      // A provider always offers at least its own default model, so an
      // organization that has not curated a catalogue is still routable.
      const enabledModels = Object.freeze([
        ...new Set(
          [...configuredModels, adapter.defaultModel].filter(
            (model): model is string => typeof model === "string" && model.length > 0,
          ),
        ),
      ]);
      const metrics = options.metricsByProvider?.[adapter.id];

      return Object.freeze({
        provider: adapter.id,
        state: providerHealth?.state ?? "not_configured",
        capabilities: adapter.capabilities,
        enabledModels,
        defaultModel: adapter.defaultModel,
        recentSuccessRate: metrics?.recentSuccessRate ?? null,
        medianLatencyMs: metrics?.medianLatencyMs ?? null,
        declaredCostPerMillionUsd: blendedDeclaredCost(adapter.id, adapter.defaultModel),
      });
    }),
  );
}
