/**
 * Core vocabulary for the graph engine.
 *
 * This module is pure data and has no I/O, so the scheduler, planner, and
 * reducers can all be exercised without a provider, a database, or a network.
 * That is deliberate: the interesting failures in a graph engine are logical
 * (a fake edge, a lost input, an unbounded discovery loop), and logical
 * failures should be catchable by a unit test rather than only in production.
 */

/** Execution shapes the planner may choose between. */
export const GRAPH_TOPOLOGIES = [
  "SINGLE_AGENT",
  "LOOP",
  "SEQUENTIAL",
  "DAG",
  "DIAMOND",
  "DISCOVERY_GRAPH",
] as const;
export type GraphTopology = (typeof GRAPH_TOPOLOGIES)[number];

/**
 * Node lifecycle.
 *
 * `VERIFYING` is separate from `RUNNING` because a node whose work finished but
 * whose verification has not is not yet safe to depend on. `SKIPPED` is
 * distinct from `CANCELLED`: skipped means the graph decided the node was
 * unnecessary, cancelled means something stopped it.
 */
export const NODE_STATES = [
  "PENDING",
  "READY",
  "RUNNING",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "SKIPPED",
] as const;
export type NodeState = (typeof NODE_STATES)[number];

/** States from which a node will never progress again. */
export const TERMINAL_NODE_STATES: readonly NodeState[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "SKIPPED",
];

export function isTerminal(state: NodeState): boolean {
  return TERMINAL_NODE_STATES.includes(state);
}

/**
 * Why an edge exists.
 *
 * Every surviving edge must name one of these. An edge that cannot name one is
 * a fake edge — an ordering someone imagined rather than a dependency the work
 * actually has — and `analyzeDependencies` removes it so the two nodes can run
 * in parallel.
 */
export const EDGE_REASONS = [
  /** B's input is populated from A's output. */
  "DATA",
  /** B reads a resource A writes. */
  "RESOURCE_READ_AFTER_WRITE",
  /** A and B write the same resource, so they must be serialized. */
  "RESOURCE_WRITE_CONFLICT",
  /** B verifies A, so it cannot start until A has produced something. */
  "VERIFICATION",
  /** The owner or a frozen policy requires this order regardless of data. */
  "POLICY",
] as const;
export type EdgeReason = (typeof EDGE_REASONS)[number];

export type GraphEdge = {
  readonly from: string;
  readonly to: string;
  readonly reason: EdgeReason;
  /** Human-readable justification, recorded so a reviewer can audit the edge. */
  readonly detail: string;
};

/**
 * A resource a node touches.
 *
 * `kind` matters as much as `id`: two nodes writing the same `file` conflict,
 * but two nodes writing different rows of the same `rate_limit` also contend.
 * Modelling the kind lets hidden-dependency detection reason about both.
 */
export const RESOURCE_KINDS = [
  "file",
  "directory",
  "migration",
  "api",
  "rate_limit",
  "external_service",
  "deployment_environment",
  "database_table",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export type ResourceRef = {
  readonly kind: ResourceKind;
  readonly id: string;
};

export function resourceKey(resource: ResourceRef): string {
  return `${resource.kind}:${resource.id}`;
}

/** Risk bands, matching the existing Phase 1D classification. */
export type RiskLevel = "GREEN" | "YELLOW" | "RED";

/** Retry behaviour for a node, bounded so no graph can retry forever. */
export type RetryPolicy = {
  readonly maxAttempts: number;
  readonly backoffMs: number;
  /** Attempt a different provider on a fallback-eligible failure. */
  readonly allowProviderFallback: boolean;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 2,
  backoffMs: 2_000,
  allowProviderFallback: true,
});
