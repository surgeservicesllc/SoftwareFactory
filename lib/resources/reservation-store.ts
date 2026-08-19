import "server-only";

import type { CapacityLimits } from "@/lib/resources/capacity";
import type { RateLimitPolicy } from "@/lib/resources/rate-limits";
import type { SupabaseLike } from "@/lib/resources/store";

/**
 * The durable side of the concurrency and rate limits.
 *
 * `lib/resources/capacity.ts` and `rate-limits.ts` decide against a reservation
 * set and a window the caller holds. That is testable and it is genuinely
 * useful inside one tick — `dispatch` relies on it to stop a batch taking the
 * same slot twice — but it cannot bound anything across processes, because each
 * process has its own copy. Two workers each see one free slot and each takes
 * it.
 *
 * So the decision itself lives in `acquire_resource_reservation`, and this
 * module is the thin call into it. The limit *values* still come from
 * TypeScript and are passed in, exactly as the breaker thresholds are, so the
 * rule has one home; what the database owns is the part TypeScript cannot do
 * safely across concurrent callers — check and take in one atomic statement.
 *
 * ## This store fails closed, and `store.ts` fails open
 *
 * `loadBreakers` returns "no observed failures" when a read fails, because a
 * breaker whose state is unknown must not block work — an unreadable breaker
 * would otherwise halt the factory on a database hiccup.
 *
 * Admission is the opposite. If usage cannot be read, the honest statement is
 * "unknown", and admitting on unknown usage means the limit silently stops
 * existing during exactly the incident it was built for. A refusal costs a
 * delay; a wrong admission costs unbounded concurrency against a provider that
 * may already be the thing that is failing. So a transport failure here is a
 * refusal, and it is labelled as one rather than dressed up as capacity.
 */

export type AcquireRefusal =
  | "WORKER_AT_CAPACITY"
  | "PROVIDER_AT_CAPACITY"
  | "PROJECT_AT_CAPACITY"
  | "REQUEST_RATE_EXCEEDED"
  | "TOKEN_RATE_EXCEEDED"
  /** The limits could not be evaluated. Not a capacity state — a failure to know. */
  | "ADMISSION_UNAVAILABLE";

export interface AcquireRequest {
  readonly projectId: string;
  readonly agentId: string;
  readonly provider: string;
  readonly model: string;
  readonly nodeId?: string | null;
  readonly leaseMs: number;
  readonly limits: CapacityLimits;
  /** Omit to skip rate accounting entirely, as the pure functions do. */
  readonly ratePolicy?: RateLimitPolicy;
  readonly estimatedTokens?: number;
}

export interface AcquireResult {
  readonly admitted: boolean;
  readonly refusal: AcquireRefusal | null;
  readonly reservationId: string | null;
  /** Only ever set for a rate refusal; a capacity refusal has no computable clearing time. */
  readonly retryAfterMs: number | null;
  readonly usage: {
    readonly worker: number;
    readonly provider: number;
    readonly project: number;
    readonly requests: number;
    readonly tokens: number;
  };
  /** Present when the refusal was `ADMISSION_UNAVAILABLE`, so the cause is not lost. */
  readonly error: string | null;
}

const UNAVAILABLE_USAGE = Object.freeze({
  worker: 0, provider: 0, project: 0, requests: 0, tokens: 0,
});

function unavailable(error: string): AcquireResult {
  return Object.freeze({
    admitted: false,
    refusal: "ADMISSION_UNAVAILABLE",
    reservationId: null,
    retryAfterMs: null,
    // Deliberately zeros with a refusal attached rather than plausible-looking
    // counts: reporting usage that was never read would make a transport
    // failure indistinguishable from a genuinely empty fleet.
    usage: UNAVAILABLE_USAGE,
    error,
  });
}

interface AcquireRow {
  admitted: boolean;
  refusal: string | null;
  reservation_id: string | null;
  retry_after_ms: number | null;
  worker_in_use: number;
  provider_in_use: number;
  project_in_use: number;
  requests_in_window: number;
  tokens_in_window: number;
}

/**
 * Ask for one slot, and take it in the same statement if it is granted.
 *
 * Never throws. Every outcome — granted, refused by a named limit, or
 * unevaluable — comes back as a result, because a caller that has to
 * distinguish "full" from "broken" inside a catch block generally does not.
 */
export async function acquireReservation(
  client: SupabaseLike,
  request: AcquireRequest,
): Promise<AcquireResult> {
  const leaseSeconds = Math.max(1, Math.ceil(request.leaseMs / 1_000));

  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await client.rpc("acquire_resource_reservation", {
      p_project_id: request.projectId,
      p_agent_id: request.agentId,
      p_provider: request.provider,
      p_model: request.model,
      p_lease_seconds: leaseSeconds,
      p_max_per_worker: request.limits.perWorker,
      p_max_per_provider: request.limits.perProvider,
      p_max_per_project: request.limits.perProject,
      p_node_id: request.nodeId ?? null,
      p_rate_window_seconds: request.ratePolicy
        ? Math.max(1, Math.ceil(request.ratePolicy.windowMs / 1_000))
        : null,
      p_max_requests_per_window: request.ratePolicy?.maxRequests ?? null,
      p_max_tokens_per_window: request.ratePolicy?.maxTokens ?? null,
      p_estimated_tokens: request.estimatedTokens ?? 0,
    });
  } catch (cause) {
    return unavailable(cause instanceof Error ? cause.message : "admission call failed");
  }

  if (response.error) return unavailable(response.error.message);

  const row = (Array.isArray(response.data) ? response.data[0] : response.data) as AcquireRow | undefined;
  // A call that succeeded but returned nothing is not an admission. Treating a
  // missing row as a grant is the one failure mode that silently removes the
  // limit, so it is read as an inability to evaluate.
  if (!row) return unavailable("admission returned no row");

  return Object.freeze({
    admitted: row.admitted === true,
    refusal: (row.refusal as AcquireRefusal | null) ?? null,
    reservationId: row.reservation_id ?? null,
    retryAfterMs: row.retry_after_ms ?? null,
    usage: Object.freeze({
      worker: row.worker_in_use ?? 0,
      provider: row.provider_in_use ?? 0,
      project: row.project_in_use ?? 0,
      requests: row.requests_in_window ?? 0,
      tokens: row.tokens_in_window ?? 0,
    }),
    error: null,
  });
}

/**
 * Give a slot back.
 *
 * Returns false when the slot was already released or expired, and also when
 * the call itself failed — the caller's next action is the same either way, and
 * the lease expiry is the backstop that makes a lost release survivable rather
 * than permanent. The distinction is preserved in `error` for anyone who needs
 * it.
 */
export async function releaseReservation(
  client: SupabaseLike,
  reservationId: string,
): Promise<{ readonly released: boolean; readonly error: string | null }> {
  try {
    const { data, error } = await client.rpc("release_resource_reservation", {
      p_reservation_id: reservationId,
    });
    if (error) return Object.freeze({ released: false, error: error.message });
    return Object.freeze({ released: data === true, error: null });
  } catch (cause) {
    return Object.freeze({
      released: false,
      error: cause instanceof Error ? cause.message : "release call failed",
    });
  }
}

/**
 * Replace the estimated token count with what the provider reported.
 *
 * Best-effort on purpose. An unsettled estimate still ages out of the window on
 * schedule, so a failure here makes the window slightly less accurate for one
 * window's duration — it does not leak, and it must not fail the run whose
 * tokens it was describing.
 */
export async function settleReservationTokens(
  client: SupabaseLike,
  reservationId: string,
  actualTokens: number,
): Promise<{ readonly settled: boolean; readonly error: string | null }> {
  if (!Number.isInteger(actualTokens) || actualTokens < 0) {
    return Object.freeze({ settled: false, error: "actual tokens must be a whole number of zero or more" });
  }
  try {
    const { data, error } = await client.rpc("settle_resource_rate_event", {
      p_reservation_id: reservationId,
      p_actual_tokens: actualTokens,
    });
    if (error) return Object.freeze({ settled: false, error: error.message });
    return Object.freeze({ settled: data === true, error: null });
  } catch (cause) {
    return Object.freeze({
      settled: false,
      error: cause instanceof Error ? cause.message : "settle call failed",
    });
  }
}
