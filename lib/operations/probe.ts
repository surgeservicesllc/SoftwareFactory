import "server-only";

import { Agent } from "undici";

import { guardedLookup } from "@/lib/operations/guarded-lookup";
import { validateMonitorTarget } from "@/lib/operations/target";
import type { SignalOutcome } from "@/lib/operations/types";

/**
 * The one real monitoring adapter in Phase 1E: a bounded outbound HTTPS probe.
 *
 * It reports only what it observed — status code, latency, and a short failure
 * reason. It never reads or stores a response body, so no production content
 * or credential can leak into control-plane evidence.
 *
 * Two separate guards, because they catch different things.
 * `validateMonitorTarget` governs which URLs may be stored at all and rejects
 * an obviously private *hostname*. That only catches the careless case: a
 * perfectly public-looking name can resolve to `127.0.0.1` or
 * `169.254.169.254`. The dispatcher below closes that by checking the address
 * at connect time, so the address checked is the address the socket reaches —
 * resolving separately and checking the result would leave the rebinding
 * window open, since the second resolution is free to disagree with the first.
 */

/**
 * Shared so probes reuse connections, and so the guard cannot be forgotten by a
 * future caller that builds its own request.
 */
const guardedAgent = new Agent({
  connect: { lookup: guardedLookup as unknown as undefined },
  connectTimeout: 10_000,
});

export interface ProbeResult {
  readonly outcome: SignalOutcome;
  readonly latencyMs: number | null;
  readonly statusCode: number | null;
  readonly failureReason: string | null;
}

export interface ProbeOptions {
  readonly targetUrl: string;
  readonly expectedStatusCode: number;
  readonly degradedLatencyMs: number;
  readonly timeoutMs: number;
}

/**
 * A blocked address surfaces as the cause of a fetch failure rather than as the
 * thrown error itself, because undici wraps connect errors.
 */
function isBlockedAddressFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (current instanceof Error && (current.name === "BlockedAddressError"
      || (current as NodeJS.ErrnoException).code === "EBLOCKEDADDRESS")) {
      return true;
    }
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

/** Injected in tests so probe behavior is verified without live network calls. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function probeHttpTarget(
  options: ProbeOptions,
  fetchImplementation: FetchLike = fetch,
): Promise<ProbeResult> {
  const validation = validateMonitorTarget(options.targetUrl);
  if (!validation.valid) {
    return {
      outcome: "unknown",
      latencyMs: null,
      statusCode: null,
      failureReason: validation.detail,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImplementation(options.targetUrl, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "SoftwareFactory-Monitor/1e" },
      // Non-standard on RequestInit but honoured by undici's fetch, which is
      // what Node's global fetch is. Tests inject their own fetch and ignore it.
      dispatcher: guardedAgent,
    } as RequestInit);
    const latencyMs = Date.now() - startedAt;

    if (response.status !== options.expectedStatusCode) {
      return {
        outcome: "fail",
        latencyMs,
        statusCode: response.status,
        failureReason: `Expected HTTP ${options.expectedStatusCode} but received ${response.status}.`,
      };
    }

    if (latencyMs > options.degradedLatencyMs) {
      return {
        outcome: "degraded",
        latencyMs,
        statusCode: response.status,
        failureReason: `Responded in ${latencyMs}ms, above the ${options.degradedLatencyMs}ms threshold.`,
      };
    }

    return { outcome: "pass", latencyMs, statusCode: response.status, failureReason: null };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const aborted = error instanceof Error && error.name === "AbortError";
    // A blocked address is reported distinctly. It is not "could not be
    // reached" — the target was reachable and we refused it, and an operator
    // who cannot tell those apart will keep retrying a monitor that will never
    // be allowed to run.
    if (isBlockedAddressFailure(error)) {
      return {
        outcome: "unknown",
        latencyMs: null,
        statusCode: null,
        failureReason: "The target hostname resolved to a private, loopback, or metadata address.",
      };
    }
    return {
      outcome: "fail",
      latencyMs,
      statusCode: null,
      failureReason: aborted
        ? `No response within ${options.timeoutMs}ms.`
        : "The production target could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}
