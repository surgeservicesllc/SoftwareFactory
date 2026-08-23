/**
 * What this worker can actually execute.
 *
 * The graph engine admits three executors and this worker now provides all
 * three: MODEL nodes go through the subscription CLI, DETERMINISTIC nodes
 * through the engine's own reducers, and ANCHOR nodes through
 * lib/worker/anchor-node-executor.ts — observations, not actions. A TEST
 * anchor reads the CI verdict for the checked-out commit, a MONITOR anchor
 * probes the configured production URL, and a DEPLOY anchor refuses by
 * policy, because Phase 1 keeps deployment owner-approved and wires this
 * worker no deployment instrument. ANCHOR support was the one gap that made
 * every lifecycle template — a graph with test/deploy/monitor nodes —
 * permanently unclaimable while the MODEL-only audits drained fine.
 *
 * The claim is matched against this list server-side, so a graph containing a
 * node this worker cannot run is never claimed and never spends a run.
 *
 * Both halves read this constant, so the set cannot drift apart.
 */
export const WORKER_SUPPORTED_EXECUTORS = ["DETERMINISTIC", "MODEL", "ANCHOR"] as const;

export type WorkerSupportedExecutor = (typeof WORKER_SUPPORTED_EXECUTORS)[number];
