import type { ProviderId, ProviderRunFailure } from "@/lib/providers/types";

/**
 * Closed error taxonomy for the provider layer.
 *
 * Fallback eligibility is a declared property of the failure class, never a
 * runtime guess. Credential and policy failures are deliberately *not*
 * fallback eligible: a broken key or a refused request must reach the owner
 * rather than be silently re-routed to a second provider.
 */
export const PROVIDER_ERROR_CODES = [
  "not_configured",
  "disabled",
  "unauthorized",
  "forbidden",
  "model_not_found",
  "capability_unsupported",
  "request_rejected",
  "rate_limited",
  "timeout",
  "upstream_unavailable",
  "invalid_response",
  "cancelled",
  "unknown",
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

type ErrorPolicy = { readonly retryable: boolean; readonly fallbackEligible: boolean };

/**
 * `fallbackEligible` answers one question: would trying a different provider
 * plausibly succeed *without* bypassing a control? A rejected prompt would be
 * rejected on policy grounds anywhere, and re-routing it is policy shopping,
 * so it stays false.
 */
const ERROR_POLICY = Object.freeze({
  not_configured: { retryable: false, fallbackEligible: true },
  disabled: { retryable: false, fallbackEligible: true },
  unauthorized: { retryable: false, fallbackEligible: false },
  forbidden: { retryable: false, fallbackEligible: false },
  model_not_found: { retryable: false, fallbackEligible: true },
  capability_unsupported: { retryable: false, fallbackEligible: true },
  request_rejected: { retryable: false, fallbackEligible: false },
  rate_limited: { retryable: true, fallbackEligible: true },
  timeout: { retryable: true, fallbackEligible: true },
  upstream_unavailable: { retryable: true, fallbackEligible: true },
  invalid_response: { retryable: true, fallbackEligible: true },
  cancelled: { retryable: false, fallbackEligible: false },
  unknown: { retryable: false, fallbackEligible: false },
} satisfies Record<ProviderErrorCode, ErrorPolicy>);

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly provider: ProviderId | null;
  readonly retryable: boolean;
  readonly fallbackEligible: boolean;

  constructor(
    code: ProviderErrorCode,
    message: string,
    provider: ProviderId | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.provider = provider;
    this.retryable = ERROR_POLICY[code].retryable;
    this.fallbackEligible = ERROR_POLICY[code].fallbackEligible;
  }

  toFailure(): ProviderRunFailure {
    return Object.freeze({
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      fallbackEligible: this.fallbackEligible,
    });
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}

/**
 * Map an unknown thrown value onto the taxonomy without leaking provider
 * internals. Only the code and a fixed message reach the caller; the original
 * error is never serialized, because SDK errors can echo request bodies.
 */
export function toProviderError(error: unknown, provider: ProviderId): ProviderError {
  if (isProviderError(error)) return error;

  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderError("cancelled", "The provider run was cancelled.", provider);
  }

  const status = readStatus(error);
  if (status !== null) {
    return new ProviderError(providerErrorCodeForStatus(status), statusMessage(status), provider);
  }

  if (error instanceof Error && /timeout|timed out/i.test(error.message)) {
    return new ProviderError("timeout", "The provider did not respond in time.", provider);
  }

  return new ProviderError("unknown", "The provider request failed.", provider);
}

export function providerErrorCodeForStatus(status: number): ProviderErrorCode {
  if (status === 400 || status === 422) return "request_rejected";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "model_not_found";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_unavailable";
  return "unknown";
}

function statusMessage(status: number): string {
  const code = providerErrorCodeForStatus(status);
  const messages: Record<ProviderErrorCode, string> = {
    not_configured: "The provider is not configured.",
    disabled: "The provider is disabled.",
    unauthorized: "The provider rejected the server credential.",
    forbidden: "The provider credential lacks access to this model.",
    model_not_found: "The provider does not recognize the requested model.",
    capability_unsupported: "The provider does not support this task kind.",
    request_rejected: "The provider rejected the request as invalid.",
    rate_limited: "The provider rate limit was reached.",
    timeout: "The provider did not respond in time.",
    upstream_unavailable: "The provider is temporarily unavailable.",
    invalid_response: "The provider returned an unusable response.",
    cancelled: "The provider run was cancelled.",
    unknown: "The provider request failed.",
  };
  return messages[code];
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

/** Map a terminal provider error onto the connection state the UI may show. */
export function connectionStateForError(
  code: ProviderErrorCode,
): "not_configured" | "disabled" | "error" {
  if (code === "not_configured") return "not_configured";
  if (code === "disabled") return "disabled";
  return "error";
}
