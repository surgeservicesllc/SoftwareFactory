import "server-only";

import { validateMonitorTarget } from "@/lib/operations/target";
import type { SignalOutcome } from "@/lib/operations/types";

/**
 * The one real monitoring adapter in Phase 1E: a bounded outbound HTTPS probe.
 *
 * It reports only what it observed — status code, latency, and a short failure
 * reason. It never reads or stores a response body, so no production content
 * or credential can leak into control-plane evidence.
 */

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
    });
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
