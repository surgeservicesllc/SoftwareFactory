import "server-only";

import { OPENAI_CODEX_PROVIDER_KEY, openAiCodexProvider } from "@/lib/providers/openai-codex";
import {
  ProviderError,
  type ProviderConfigurationStatus,
  type WorkerProvider,
} from "@/lib/providers/types";

/**
 * Provider registry.
 *
 * The product is deliberately not built around one vendor: an agent resolves to
 * a provider, a provider resolves to a model, and a model produces a worker run.
 * Providers that are planned but not implemented are listed truthfully rather
 * than hidden, so the Connections surface can never imply a capability that
 * does not exist.
 */

export type PlannedProvider = {
  readonly key: string;
  readonly label: string;
  readonly phase: string;
  readonly status: ProviderConfigurationStatus;
};

const implementedProviders: readonly WorkerProvider[] = [openAiCodexProvider];

export const PLANNED_PROVIDERS: readonly PlannedProvider[] = [
  {
    key: "anthropic_claude",
    label: "Anthropic Claude",
    phase: "Phase 2",
    status: {
      state: "not_connected",
      label: "Not Connected",
      detail:
        "Claude worker execution is Phase 2 and has no adapter in this build. Nothing is queued, authorized, or partially wired.",
      ownerAction: null,
    },
  },
];

export function listWorkerProviders(): readonly WorkerProvider[] {
  return implementedProviders;
}

export function findWorkerProvider(key: string): WorkerProvider | null {
  return implementedProviders.find((provider) => provider.key === key) ?? null;
}

export function requireWorkerProvider(key: string): WorkerProvider {
  const provider = findWorkerProvider(key);
  if (!provider) {
    throw new ProviderError(
      "provider_not_configured",
      `No worker provider adapter is registered for "${key}".`,
    );
  }
  return provider;
}

export function isSupportedModel(providerKey: string, model: string): boolean {
  const provider = findWorkerProvider(providerKey);
  return provider ? provider.models.includes(model) : false;
}

export const DEFAULT_PROVIDER_KEY = OPENAI_CODEX_PROVIDER_KEY;

export function describeProviders() {
  return {
    implemented: implementedProviders.map((provider) => ({
      key: provider.key,
      label: provider.label,
      defaultModel: provider.defaultModel,
      models: provider.models,
      status: provider.describeConfiguration(),
    })),
    planned: PLANNED_PROVIDERS,
  };
}
