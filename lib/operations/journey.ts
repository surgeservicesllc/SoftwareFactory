import "server-only";

import { probeHttpTarget, type FetchLike } from "@/lib/operations/probe";
import { validateSyntheticJourney, type SyntheticJourney, type SyntheticStep } from "@/lib/operations/synthetic";
import { validateMonitorTarget } from "@/lib/operations/target";
import type { SignalOutcome } from "@/lib/operations/types";

/**
 * Execute a stored synthetic journey against production.
 *
 * Steps run in order and stop at the first failure: once the app shell is down,
 * pushing further requests at a broken production surface tells you nothing new
 * and costs the failing system more traffic.
 *
 * Every request goes through the same bounded probe as an uptime check, so the
 * target validation, redirect refusal, and no-response-body rule all apply.
 * Only GET and HEAD are actually issued — a declared safe write is recorded as
 * skipped rather than performed, because Phase 1E has no authorization to
 * mutate a monitored production system.
 */

export interface JourneyStepResult {
  readonly name: string;
  readonly kind: SyntheticStep["kind"];
  readonly outcome: SignalOutcome | "skipped";
  readonly statusCode: number | null;
  readonly latencyMs: number | null;
  readonly detail: string | null;
}

export interface JourneyRunResult {
  readonly outcome: SignalOutcome;
  readonly latencyMs: number | null;
  readonly failedStep: string | null;
  readonly failureReason: string | null;
  readonly steps: readonly JourneyStepResult[];
}

export interface JourneyRunOptions {
  readonly baseUrl: string;
  readonly journey: SyntheticJourney;
  readonly degradedLatencyMs: number;
  readonly timeoutMs: number;
}

function joinUrl(baseUrl: string, path: string): string | null {
  try {
    return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

export async function runSyntheticJourney(
  options: JourneyRunOptions,
  fetchImplementation: FetchLike = fetch,
): Promise<JourneyRunResult> {
  const validation = validateSyntheticJourney(options.journey);
  if (!validation.valid) {
    return {
      outcome: "unknown",
      latencyMs: null,
      failedStep: null,
      failureReason: validation.rejections[0]?.detail ?? "The journey is not safe to run.",
      steps: [],
    };
  }

  const steps: JourneyStepResult[] = [];
  let totalLatency = 0;
  let measuredSteps = 0;
  let degraded = false;

  for (const step of options.journey.steps) {
    // A declared safe write is never actually issued in this phase.
    if (step.method === "POST") {
      steps.push({
        name: step.name,
        kind: step.kind,
        outcome: "skipped",
        statusCode: null,
        latencyMs: null,
        detail: "Write steps are recorded but not executed: production writes are Not Connected.",
      });
      continue;
    }

    const url = joinUrl(options.baseUrl, step.path);
    if (!url || !validateMonitorTarget(url).valid) {
      return {
        outcome: "unknown",
        latencyMs: null,
        failedStep: step.name,
        failureReason: "A journey step resolved to a target that cannot be probed.",
        steps,
      };
    }

    const probe = await probeHttpTarget(
      {
        targetUrl: url,
        expectedStatusCode: step.expectedStatus,
        degradedLatencyMs: options.degradedLatencyMs,
        timeoutMs: options.timeoutMs,
      },
      fetchImplementation,
    );

    steps.push({
      name: step.name,
      kind: step.kind,
      outcome: probe.outcome,
      statusCode: probe.statusCode,
      latencyMs: probe.latencyMs,
      detail: probe.failureReason,
    });

    if (probe.latencyMs !== null) {
      totalLatency += probe.latencyMs;
      measuredSteps += 1;
    }

    if (probe.outcome === "fail") {
      return {
        outcome: "fail",
        latencyMs: measuredSteps ? totalLatency : null,
        failedStep: step.name,
        failureReason: probe.failureReason ?? `Step "${step.name}" failed.`,
        steps,
      };
    }
    if (probe.outcome === "unknown") {
      return {
        outcome: "unknown",
        latencyMs: measuredSteps ? totalLatency : null,
        failedStep: step.name,
        failureReason: probe.failureReason ?? `Step "${step.name}" could not run.`,
        steps,
      };
    }
    if (probe.outcome === "degraded") degraded = true;
  }

  // A journey where every step was skipped proves nothing about production.
  if (measuredSteps === 0) {
    return {
      outcome: "unknown",
      latencyMs: null,
      failedStep: null,
      failureReason: "No journey step was actually executed.",
      steps,
    };
  }

  return {
    outcome: degraded ? "degraded" : "pass",
    latencyMs: totalLatency,
    failedStep: null,
    failureReason: degraded ? "One or more steps responded slower than the threshold." : null,
    steps,
  };
}
