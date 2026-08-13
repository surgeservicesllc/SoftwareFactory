import "server-only";

import { isProviderError, toProviderError } from "@/lib/providers/errors";
import { getProviderAdapter } from "@/lib/providers/registry";
import {
  planFallback,
  routeProvider,
  type RoutingDecision,
  type RoutingRequest,
} from "@/lib/providers/routing";
import type {
  ProviderAdapter,
  ProviderId,
  ProviderRunContext,
  ProviderRunResult,
} from "@/lib/providers/types";

/**
 * Orchestration: route, execute, and — where policy allows — fall back once.
 *
 * This module owns no persistence. It returns a complete, auditable record of
 * what was attempted so the calling route can write it to Supabase in one
 * audited transaction. Keeping it storage-free also keeps it unit testable
 * with stub adapters.
 */

export const PROVIDER_RUNTIME_VERSION = "phase2a-runtime-v1";

export interface ExecuteTaskRequest {
  readonly runId: string;
  readonly routing: RoutingRequest;
  readonly agentId: string;
  readonly instructions: string;
  readonly context: ProviderRunContext;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

export interface ProviderAttempt {
  readonly attempt: number;
  readonly provider: ProviderId;
  readonly model: string;
  readonly decision: RoutingDecision;
  readonly result: ProviderRunResult;
}

export type ExecutionOutcome =
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "NOT_ROUTED"
  | "BLOCKED_BY_RISK_POLICY";

export interface ExecuteTaskResponse {
  readonly runtimeVersion: typeof PROVIDER_RUNTIME_VERSION;
  readonly outcome: ExecutionOutcome;
  readonly primaryDecision: RoutingDecision;
  readonly attempts: readonly ProviderAttempt[];
  /** The successful attempt, when there is one. */
  readonly finalAttempt: ProviderAttempt | null;
  /** Set when a fallback attempt ran; records where the work came from. */
  readonly fallbackFromProvider: ProviderId | null;
  readonly fallbackReason: string | null;
}

/** Injectable for tests; production resolves the real adapters. */
export type AdapterResolver = (provider: ProviderId) => ProviderAdapter;

const MAX_ATTEMPTS = 2;

export async function executeProviderTask(
  request: ExecuteTaskRequest,
  resolveAdapter: AdapterResolver = getProviderAdapter,
): Promise<ExecuteTaskResponse> {
  const primaryDecision = routeProvider(request.routing);

  if (primaryDecision.decision === "BLOCKED_BY_RISK_POLICY") {
    return frozenResponse("BLOCKED_BY_RISK_POLICY", primaryDecision, [], null, null, null);
  }
  if (primaryDecision.decision !== "ROUTED" || !primaryDecision.provider || !primaryDecision.model) {
    return frozenResponse("NOT_ROUTED", primaryDecision, [], null, null, null);
  }

  const attempts: ProviderAttempt[] = [];
  let decision: RoutingDecision = primaryDecision;
  let fallbackFromProvider: ProviderId | null = null;
  let fallbackReason: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const provider = decision.provider;
    const model = decision.model;
    if (!provider || !model) break;

    const result = await runOnce(request, provider, model, resolveAdapter);
    const record: ProviderAttempt = Object.freeze({ attempt, provider, model, decision, result });
    attempts.push(record);

    if (result.status === "succeeded") {
      return frozenResponse(
        "SUCCEEDED",
        primaryDecision,
        attempts,
        record,
        fallbackFromProvider,
        fallbackReason,
      );
    }
    if (result.status === "cancelled") {
      return frozenResponse(
        "CANCELLED",
        primaryDecision,
        attempts,
        null,
        fallbackFromProvider,
        fallbackReason,
      );
    }

    if (attempt === MAX_ATTEMPTS || !result.error) break;

    const fallback = planFallback(request.routing, provider, {
      code: result.error.code,
      fallbackEligible: result.error.fallbackEligible,
    });
    if (!fallback.allowed || !fallback.decision) {
      // Record why no second attempt happened so the run explains itself.
      fallbackReason = fallback.reasons[0]?.detail ?? null;
      break;
    }

    fallbackFromProvider = provider;
    fallbackReason = fallback.reasons[0]?.detail ?? null;
    decision = fallback.decision;
  }

  return frozenResponse("FAILED", primaryDecision, attempts, null, fallbackFromProvider, fallbackReason);
}

async function runOnce(
  request: ExecuteTaskRequest,
  provider: ProviderId,
  model: string,
  resolveAdapter: AdapterResolver,
): Promise<ProviderRunResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  try {
    const adapter = resolveAdapter(provider);
    await adapter.createRun({
      runId: request.runId,
      taskKind: request.routing.taskKind,
      agentRole: request.routing.agentAssignment?.agentRole ?? "orchestrator",
      agentId: request.agentId,
      instructions: request.instructions,
      context: request.context,
      model,
      maxOutputTokens: request.maxOutputTokens,
      timeoutMs: request.timeoutMs,
    });
    return await adapter.getResult(request.runId);
  } catch (error) {
    // createRun can reject before a run record exists (capability or
    // configuration failures). Synthesize the same terminal shape so every
    // attempt is recorded identically.
    const providerError = isProviderError(error) ? error : toProviderError(error, provider);
    const completedAt = new Date().toISOString();

    return Object.freeze({
      provider,
      model,
      providerRunId: null,
      status: providerError.code === "cancelled" ? "cancelled" : "failed",
      output: null,
      usage: null,
      latencyMs: Date.now() - startedMs,
      startedAt,
      completedAt,
      error: providerError.toFailure(),
      events: Object.freeze([
        Object.freeze({
          sequence: 1,
          at: completedAt,
          type: "run_failed" as const,
          message: `${providerError.code}: ${providerError.message}`,
        }),
      ]),
    });
  }
}

function frozenResponse(
  outcome: ExecutionOutcome,
  primaryDecision: RoutingDecision,
  attempts: readonly ProviderAttempt[],
  finalAttempt: ProviderAttempt | null,
  fallbackFromProvider: ProviderId | null,
  fallbackReason: string | null,
): ExecuteTaskResponse {
  return Object.freeze({
    runtimeVersion: PROVIDER_RUNTIME_VERSION,
    outcome,
    primaryDecision,
    attempts: Object.freeze([...attempts]),
    finalAttempt,
    fallbackFromProvider,
    fallbackReason,
  });
}
