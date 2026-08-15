import type { CompiledGraph } from "@/lib/graph/compiler";
import type { GraphMetrics } from "@/lib/graph/observability";

/**
 * The graph optimizer.
 *
 * It recommends; it never rewrites. A graph that silently reshapes itself
 * between runs is not reproducible, and the failure mode of an over-eager
 * optimizer is severe: dropping a verification step or widening a fan-out past
 * a rate limit both look like speedups right up until they are outages.
 *
 * So every recommendation here is **conservative** in three specific senses:
 *
 * 1. It needs evidence from an observed run, not a prediction.
 * 2. It states what it would cost as well as what it would save.
 * 3. It never proposes removing verification, weakening a lock, or lowering the
 *    model tier of judgement work. Those are the recommendations that would be
 *    most often accepted and most damaging when wrong.
 */

export const RECOMMENDATION_KINDS = [
  "COLLAPSE_TO_SINGLE_AGENT",
  "WIDEN_PARALLELISM",
  "SPLIT_CRITICAL_PATH_NODE",
  "LOWER_MODEL_TIER",
  "RAISE_MODEL_TIER",
  "ADD_VERIFICATION",
  "REDUCE_RETRY_WASTE",
  "TIGHTEN_REDUCTION",
] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

export type Recommendation = {
  readonly kind: RecommendationKind;
  readonly detail: string;
  /** What accepting this would give up. Never empty. */
  readonly tradeoff: string;
  /** Observations supporting it. A recommendation with none is not emitted. */
  readonly evidence: readonly string[];
  readonly confidence: "LOW" | "MEDIUM" | "HIGH";
};

/**
 * A single run is an anecdote. Below this many observed runs the optimizer
 * reports what it saw but will not recommend reshaping anything, because one
 * slow run is as likely to be a cold cache as a bad graph.
 */
export const MIN_RUNS_FOR_STRUCTURAL_CHANGE = 3;

export type OptimizerInput = {
  readonly graph: CompiledGraph;
  readonly metrics: GraphMetrics;
  /** How many completed runs of this graph shape the metrics summarize. */
  readonly observedRuns: number;
};

export function recommend(input: OptimizerInput): readonly Recommendation[] {
  const { graph, metrics, observedRuns } = input;
  const recommendations: Recommendation[] = [];
  const structural = observedRuns >= MIN_RUNS_FOR_STRUCTURAL_CHANGE;

  // The most valuable recommendation the optimizer can make, and the one an
  // orchestration engine is least inclined to: this did not need to be a graph.
  if (
    structural &&
    metrics.achievedParallelism !== null &&
    metrics.achievedParallelism < 1.5 &&
    graph.topology !== "SINGLE_AGENT" &&
    graph.nodes.length <= 5
  ) {
    recommendations.push({
      kind: "COLLAPSE_TO_SINGLE_AGENT",
      detail:
        "This graph ran essentially sequentially. One agent doing the same work would avoid the scheduler, the handoffs and the reduce step.",
      tradeoff:
        "Loses per-node contracts and per-node verification; a failure becomes harder to localize.",
      evidence: [
        `Achieved parallelism ${metrics.achievedParallelism}× against a planned ${graph.maxParallelism}×.`,
        `${graph.nodes.length} nodes across ${observedRuns} runs.`,
      ],
      confidence: "MEDIUM",
    });
  }

  if (
    structural &&
    metrics.achievedParallelism !== null &&
    graph.maxParallelism - metrics.achievedParallelism >= 2
  ) {
    recommendations.push({
      kind: "WIDEN_PARALLELISM",
      detail:
        "Nodes queued rather than overlapping. Raising the concurrency limit, or checking for lock contention, would close the gap between planned and achieved width.",
      tradeoff:
        "More concurrent provider calls raises rate-limit and cost-spike exposure; the budget ceiling should be checked first.",
      evidence: [
        `Planned width ${graph.maxParallelism}, achieved ${metrics.achievedParallelism}.`,
        `Total node time ${metrics.totalNodeTimeMs}ms against ${metrics.totalDurationMs}ms wall time.`,
      ],
      confidence: "MEDIUM",
    });
  }

  if (
    structural &&
    metrics.criticalPathDurationMs !== null &&
    metrics.totalDurationMs > 0 &&
    metrics.criticalPathDurationMs / metrics.totalDurationMs > 0.7 &&
    metrics.criticalPath.length > 0
  ) {
    recommendations.push({
      kind: "SPLIT_CRITICAL_PATH_NODE",
      detail: `The critical path dominates the run. Splitting or speeding up ${metrics.criticalPath.join(" → ")} would move total time more than adding width anywhere else.`,
      tradeoff:
        "Splitting a node adds a handoff and a contract boundary, which is only worth it if the halves are genuinely independent.",
      evidence: [
        `Critical path ${metrics.criticalPathDurationMs}ms of ${metrics.totalDurationMs}ms total.`,
      ],
      confidence: "HIGH",
    });
  }

  // Trust recommendations do not wait for three runs. An unverified graph is
  // unverified the first time, and delaying that observation serves nobody.
  if (metrics.verifierRejectionRate === null) {
    recommendations.push({
      kind: "ADD_VERIFICATION",
      detail:
        "No node in this graph was independently verified, so its output is a set of assertions rather than a checked result.",
      tradeoff: "Verification costs an additional call per verified node.",
      evidence: [`${metrics.verifiedNodeCount} verified nodes across ${observedRuns} run(s).`],
      confidence: "HIGH",
    });
  } else if (metrics.verifierRejectionRate >= 0.3) {
    recommendations.push({
      kind: "RAISE_MODEL_TIER",
      detail:
        "Verifiers rejected a large share of this graph's output. A stronger model on the rejected capability is likely cheaper than the retries the rejections cause.",
      tradeoff: "A stronger tier costs more per call.",
      evidence: [
        `Verifier rejection rate ${metrics.verifierRejectionRate} across ${metrics.verifiedNodeCount} verified nodes.`,
      ],
      confidence: "MEDIUM",
    });
  }

  if (structural && metrics.retryRate !== null && metrics.retryRate >= 0.25) {
    recommendations.push({
      kind: "REDUCE_RETRY_WASTE",
      detail:
        "A quarter or more of the nodes that ran needed a second attempt. Retries spend budget without producing new work, so the cause is worth finding before the limits are raised.",
      tradeoff:
        "Lowering the attempt ceiling without fixing the cause converts retries into failures.",
      evidence: [`Retry rate ${metrics.retryRate}, ${metrics.retryCount} extra attempts.`],
      confidence: "MEDIUM",
    });
  }

  if (structural && metrics.retentionRatio !== null && metrics.retentionRatio > 0.9) {
    recommendations.push({
      kind: "TIGHTEN_REDUCTION",
      detail:
        "Reduction discarded almost nothing, so the reduce step is currently paying for itself only in ordering. Either the inspectors overlap less than assumed, or the dedupe key is too specific.",
      tradeoff:
        "A broader dedupe key risks collapsing genuinely distinct findings into one.",
      evidence: [`Reduction retained ${Math.round(metrics.retentionRatio * 100)}% of items.`],
      confidence: "LOW",
    });
  }

  // Economy, but never on judgement. This is the frozen rule the resource
  // manager also enforces, restated here so an optimizer recommendation cannot
  // become the way around it.
  const cheapCandidates = graph.nodes.filter(
    (node) =>
      node.modelTier === "STRONG" &&
      (node.capability === "extraction" || node.capability === "reporting"),
  );
  if (structural && cheapCandidates.length > 0 && metrics.verifierRejectionRate === 0) {
    recommendations.push({
      kind: "LOWER_MODEL_TIER",
      detail: `${cheapCandidates
        .map((node) => node.nodeKey)
        .join(", ")} run structure-shuffling work on the strongest tier and were never rejected. An economy tier is likely sufficient.`,
      tradeoff:
        "If these nodes later carry judgement rather than extraction, the cheaper tier will show up as quality loss before it shows up as an error.",
      evidence: [
        `${cheapCandidates.length} extraction/reporting node(s) at STRONG tier.`,
        `Verifier rejection rate 0 across ${observedRuns} runs.`,
      ],
      confidence: "LOW",
    });
  }

  return recommendations;
}

/**
 * Why the optimizer is staying quiet.
 *
 * Returned so the UI can distinguish "this graph is well shaped" from "not
 * enough has been observed to say" — the same distinction the metrics draw
 * between a zero and a null.
 */
export function abstentionReason(input: OptimizerInput): string | null {
  if (input.observedRuns === 0) {
    return "This graph has never completed a run, so there is nothing to measure.";
  }
  if (input.observedRuns < MIN_RUNS_FOR_STRUCTURAL_CHANGE) {
    return `Only ${input.observedRuns} run(s) observed. Structural recommendations need ${MIN_RUNS_FOR_STRUCTURAL_CHANGE}, because a single slow run is as likely to be a cold start as a badly shaped graph.`;
  }
  return null;
}
