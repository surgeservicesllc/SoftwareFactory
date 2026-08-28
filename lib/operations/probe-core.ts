import { Agent } from "undici";

import { guardedLookup } from "@/lib/operations/guarded-lookup-core";
import { validateMonitorTarget } from "@/lib/operations/target";
import type { SignalOutcome } from "@/lib/operations/types";

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

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Bounded, redirect-refusing, DNS-rebinding-safe HTTPS probe. */
export async function probeHttpTarget(
  options: ProbeOptions,
  fetchImplementation: FetchLike = fetch,
): Promise<ProbeResult> {
  const validation = validateMonitorTarget(options.targetUrl);
  if (!validation.valid) {
    return { outcome: "unknown", latencyMs: null, statusCode: null, failureReason: validation.detail };
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
