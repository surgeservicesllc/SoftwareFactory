import "server-only";

import { PROVIDER_IDS, type ProviderId } from "@/lib/providers/types";

/**
 * Server-only provider configuration.
 *
 * Absence of a credential is never an error: it resolves to `configured:
 * false`, which the UI renders as **Not Configured**. Only malformed
 * configuration throws. No function here returns, logs, or serializes a secret
 * value — callers receive presence flags and non-secret metadata only.
 */

export class ProviderConfigurationError extends Error {
  readonly provider: ProviderId;

  constructor(provider: ProviderId, message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
    this.provider = provider;
  }
}

export interface ProviderRuntimeConfiguration {
  readonly provider: ProviderId;
  /** True when a server-side credential is present and well formed. */
  readonly configured: boolean;
  /** True when the owner explicitly switched the provider off. */
  readonly disabled: boolean;
  /** Non-secret origin used for requests. */
  readonly baseUrl: string | null;
  /** The model used when a caller does not name one. Null means owner setup. */
  readonly defaultModel: string | null;
  readonly requestTimeoutMs: number;
  /** Secret-free explanation of why the provider is not usable, if it is not. */
  readonly unavailableReason: string | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 600_000;

/**
 * The Anthropic default is a real, current model id. The OpenAI default is
 * intentionally absent: this codebase has no verified OpenAI model catalogue,
 * and guessing an id would produce confident 404s at run time. The owner
 * selects one with OPENAI_DEFAULT_MODEL or through the model configuration
 * table, and `listModels()` on the adapter enumerates the real options.
 */
const BUILT_IN_DEFAULT_MODEL: Record<ProviderId, string | null> = {
  anthropic: "claude-opus-5",
  openai: null,
};

const ENVIRONMENT_KEYS: Record<
  ProviderId,
  {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly defaultModel: string;
    readonly disabled: string;
  }
> = {
  anthropic: {
    apiKey: "ANTHROPIC_API_KEY",
    baseUrl: "ANTHROPIC_BASE_URL",
    defaultModel: "ANTHROPIC_DEFAULT_MODEL",
    disabled: "ANTHROPIC_PROVIDER_DISABLED",
  },
  openai: {
    apiKey: "OPENAI_API_KEY",
    baseUrl: "OPENAI_BASE_URL",
    defaultModel: "OPENAI_DEFAULT_MODEL",
    disabled: "OPENAI_PROVIDER_DISABLED",
  },
};

/** Model identifiers are opaque provider strings; bound their shape anyway. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function readTrimmed(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function readBooleanFlag(name: string): boolean {
  const value = readTrimmed(name).toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function parseBaseUrl(provider: ProviderId, name: string): string | null {
  const raw = readTrimmed(name);
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProviderConfigurationError(provider, `${name} must be a valid URL.`);
  }

  const localHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new ProviderConfigurationError(
      provider,
      `${name} must use HTTPS outside local development.`,
    );
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ProviderConfigurationError(
      provider,
      `${name} must not include credentials, a query string, or a fragment.`,
    );
  }

  return parsed.toString().replace(/\/$/, "");
}

function parseModelId(provider: ProviderId, name: string): string | null {
  const raw = readTrimmed(name);
  if (!raw) return null;
  if (!MODEL_ID_PATTERN.test(raw)) {
    throw new ProviderConfigurationError(provider, `${name} is not a valid model identifier.`);
  }
  return raw;
}

function parseTimeoutMs(): number {
  const raw = readTrimmed("AI_PROVIDER_TIMEOUT_MS");
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

/**
 * Reject values that are obviously not a server credential. This checks shape
 * only — it never records, hashes, or returns the value itself.
 */
function credentialIsWellFormed(value: string): boolean {
  if (value.length < 20 || value.length > 512) return false;
  return !/\s/.test(value);
}

export function resolveProviderConfiguration(
  provider: ProviderId,
): ProviderRuntimeConfiguration {
  const keys = ENVIRONMENT_KEYS[provider];
  const disabled = readBooleanFlag(keys.disabled);
  const baseUrl = parseBaseUrl(provider, keys.baseUrl);
  const defaultModel = parseModelId(provider, keys.defaultModel) ?? BUILT_IN_DEFAULT_MODEL[provider];
  const requestTimeoutMs = parseTimeoutMs();

  const rawKey = readTrimmed(keys.apiKey);
  const configured = rawKey.length > 0 && credentialIsWellFormed(rawKey);

  let unavailableReason: string | null = null;
  if (disabled) {
    unavailableReason = `${keys.disabled} is set, so this provider is switched off.`;
  } else if (!rawKey) {
    unavailableReason = `${keys.apiKey} is not set on the server.`;
  } else if (!configured) {
    unavailableReason = `${keys.apiKey} is present but is not a well-formed credential.`;
  } else if (!defaultModel) {
    unavailableReason = `${keys.defaultModel} is not set, so no model is selected for this provider.`;
  }

  return Object.freeze({
    provider,
    configured,
    disabled,
    baseUrl,
    defaultModel,
    requestTimeoutMs,
    unavailableReason,
  });
}

export function resolveAllProviderConfigurations(): readonly ProviderRuntimeConfiguration[] {
  return Object.freeze(PROVIDER_IDS.map((provider) => resolveProviderConfiguration(provider)));
}

/**
 * Read the credential for a provider. Server-only, never returned to a route
 * handler, and only ever handed directly to the provider SDK constructor.
 */
export function readProviderCredential(provider: ProviderId): string | null {
  const raw = readTrimmed(ENVIRONMENT_KEYS[provider].apiKey);
  return raw && credentialIsWellFormed(raw) ? raw : null;
}

/** The environment variable names for a provider. Names only, never values. */
export function providerEnvironmentVariableNames(provider: ProviderId): readonly string[] {
  const keys = ENVIRONMENT_KEYS[provider];
  return Object.freeze([keys.apiKey, keys.baseUrl, keys.defaultModel, keys.disabled]);
}
