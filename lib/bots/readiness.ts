import { findBotProvider } from "@/lib/bots/catalog";

/**
 * Readiness is a statement about configuration, not about connectivity.
 *
 * `ready` means every piece of configuration a future worker will need resolves
 * on this server right now. It does not mean a provider session was opened, a
 * request was answered, or that any executor exists — no worker is connected in
 * this phase, and the UI says so alongside every readiness badge.
 */

export const BOT_READINESS_VALUES = ["not_connected", "ready", "blocked", "disabled"] as const;

export type BotReadiness = (typeof BOT_READINESS_VALUES)[number];

export type ReadinessInput = {
  provider: string;
  model: string;
  credentialRef: string | null;
  baseUrl: string | null;
  /** Resolved server-side; the credential value itself never reaches here. */
  credentialPresent: boolean;
};

export type ReadinessVerdict = {
  readiness: BotReadiness;
  detail: string;
};

export function isBotReadiness(value: unknown): value is BotReadiness {
  return typeof value === "string" && (BOT_READINESS_VALUES as readonly string[]).includes(value);
}

export function evaluateBotReadiness(input: ReadinessInput): ReadinessVerdict {
  const provider = findBotProvider(input.provider);
  if (!provider) {
    return { readiness: "blocked", detail: "This provider is not in the supported catalog." };
  }

  if (!input.model.trim()) {
    return { readiness: "blocked", detail: "Set a model identifier for this bot." };
  }

  if (input.baseUrl && !input.baseUrl.startsWith("https://")) {
    return { readiness: "blocked", detail: "The endpoint must be an HTTPS URL." };
  }

  if (provider.requiresBaseUrl && !input.baseUrl) {
    return {
      readiness: "blocked",
      detail: `${provider.label} needs an HTTPS endpoint before it can be used.`,
    };
  }

  if (!input.credentialRef) {
    return provider.defaultCredentialRef
      ? {
        readiness: "not_connected",
        detail: `Reference a server-side variable such as ${provider.defaultCredentialRef}.`,
      }
      : {
        readiness: "ready",
        detail: "Configuration resolves server-side. No worker is connected yet.",
      };
  }

  if (!input.credentialPresent) {
    return {
      readiness: "not_connected",
      detail: `${input.credentialRef} is not set on this server.`,
    };
  }

  return {
    readiness: "ready",
    detail: "Credential reference and configuration resolve server-side. No worker is connected yet.",
  };
}

const READINESS_LABELS: Record<BotReadiness, string> = {
  ready: "Ready to assign",
  not_connected: "Needs credential",
  blocked: "Needs setup",
  disabled: "Disabled",
};

const READINESS_TONES: Record<BotReadiness, "safe" | "warning" | "danger" | "neutral"> = {
  ready: "safe",
  not_connected: "warning",
  blocked: "danger",
  disabled: "neutral",
};

export function readinessLabel(readiness: BotReadiness): string {
  return READINESS_LABELS[readiness];
}

export function readinessTone(readiness: BotReadiness) {
  return READINESS_TONES[readiness];
}
