import type { CompiledNode } from "@/lib/graph/compiler";
import type { ModelTier, NodeCapability } from "@/lib/graph/contracts";
import type { NodeExecutionResult } from "@/lib/graph/runner";
import type { RoutingRequest } from "@/lib/providers/routing";
import type { ExecuteTaskResponse } from "@/lib/providers/runtime";
import type { ProviderId, ProviderTaskKind } from "@/lib/providers/types";

/**
 * The bridge between a graph node and the Phase 2A provider layer.
 *
 * Kept as pure mapping functions rather than a class that owns a client, so
 * every decision here — which task kind a capability implies, which providers a
 * model tier will accept, how a provider outcome becomes a node result — is
 * testable without a credential. The one function that actually calls a
 * provider takes `executeProviderTask` as an argument.
 *
 * The mapping that matters most is failure. The provider layer already decides
 * whether an error class is fallback-eligible; this must not second-guess it.
 * A credential failure retried against the same credential just spends money to
 * fail again, and a content-policy refusal retried elsewhere is the system
 * shopping for a provider that will say yes — which is the specific behaviour
 * the error taxonomy exists to prevent.
 */

/** Which provider task kind a node capability corresponds to. */
export const CAPABILITY_TASK_KIND: Readonly<Record<NodeCapability, ProviderTaskKind>> =
  Object.freeze({
    planning: "plan",
    architecture: "architecture_review",
    implementation: "implementation_proposal",
    extraction: "plan",
    review: "implementation_review",
    security_review: "security_review",
    qa: "qa_assessment",
    synthesis: "status_report",
    reporting: "status_report",
    // All three are analysis with structured output — the same provider
    // demands "plan" already makes. Nothing about them proposes or writes.
    discovery: "plan",
    evaluation: "plan",
    decision: "plan",
  });

export function taskKindForNode(node: CompiledNode): ProviderTaskKind {
  return CAPABILITY_TASK_KIND[node.capability as NodeCapability] ?? "plan";
}

/**
 * Output-token ceiling by tier.
 *
 * A cheap extraction node asking for a huge completion is how a graph's cost
 * escapes its tier without anyone choosing that.
 */
export const TIER_MAX_OUTPUT_TOKENS: Readonly<Record<ModelTier, number>> = Object.freeze({
  NONE: 0,
  ECONOMY: 2_000,
  STANDARD: 8_000,
  STRONG: 16_000,
});

export function maxOutputTokensForNode(node: CompiledNode): number {
  return TIER_MAX_OUTPUT_TOKENS[node.modelTier as ModelTier] ?? 8_000;
}

/**
 * Build the routing request for a node.
 *
 * `excludedProviders` carries providers already tried in this attempt chain, so
 * a fallback does not reselect the provider that just failed.
 */
export function routingRequestForNode(input: {
  readonly node: CompiledNode;
  readonly base: Omit<RoutingRequest, "taskKind" | "riskLevel" | "excludedProviders">;
  /** Providers already tried in this chain, so a fallback does not reselect one. */
  readonly excludedProviders?: readonly ProviderId[];
}): RoutingRequest {
  return {
    ...input.base,
    taskKind: taskKindForNode(input.node),
    riskLevel: input.node.risk,
    excludedProviders: input.excludedProviders,
  };
}

/**
 * Translate a provider execution response into a node result.
 *
 * `retryable` is taken from what the provider layer actually did rather than
 * guessed: if the runtime already exhausted its attempts and any fallback it
 * was allowed, there is nothing left for the node to retry into.
 */
export function toNodeExecutionResult(response: ExecuteTaskResponse): NodeExecutionResult {
  const attempt = response.finalAttempt ?? response.attempts.at(-1) ?? null;
  const usage = attempt?.result.usage;

  if (response.outcome === "SUCCEEDED" && attempt) {
    return {
      status: "SUCCEEDED",
      output: attempt.result.output,
      provider: attempt.provider,
      model: attempt.model,
      latencyMs: attempt.result.latencyMs ?? undefined,
      tokensUsed:
        usage === undefined || usage === null
          ? undefined
          : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      // Only when the provider layer computed a real cost. Absent stays absent.
      costMicros: usage?.estimatedCostMicros ?? undefined,
    };
  }

  // Never routed and risk-blocked are decisions, not transient faults. Retrying
  // them re-runs the same decision and gets the same answer.
  const permanent =
    response.outcome === "NOT_ROUTED" ||
    response.outcome === "BLOCKED_BY_RISK_POLICY" ||
    response.outcome === "CANCELLED";

  const error =
    attempt?.result.error?.message ??
    (response.outcome === "NOT_ROUTED"
      ? "No eligible provider was available for this node."
      : response.outcome === "BLOCKED_BY_RISK_POLICY"
        ? "The node's risk exceeds the project routing ceiling."
        : "The provider run did not succeed.");

  return {
    status: "FAILED",
    error,
    retryable: !permanent && Boolean(attempt?.result.error?.retryable),
    provider: attempt?.provider,
    model: attempt?.model,
    latencyMs: attempt?.result.latencyMs ?? undefined,
    // A failed call still costs money, so its usage is reported too.
    tokensUsed:
      usage === undefined || usage === null
        ? undefined
        : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    costMicros: usage?.estimatedCostMicros ?? undefined,
  };
}

/**
 * A deterministic node must never reach a provider.
 *
 * Enforced rather than assumed: routing a `DETERMINISTIC` node would spend
 * money on work that code does exactly and for free, and the mistake is easy to
 * make once a runner treats every node the same way.
 */
export function assertNodeMayCallProvider(node: CompiledNode): void {
  if (node.executor !== "MODEL") {
    throw new Error(
      `Node ${node.nodeKey} is ${node.executor} and must not call a provider.`,
    );
  }
  if (node.modelTier === "NONE") {
    throw new Error(
      `Node ${node.nodeKey} declares model tier NONE and must not call a provider.`,
    );
  }
}
