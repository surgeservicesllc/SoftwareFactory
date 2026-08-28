/**
 * What this worker can actually execute.
 *
 * The graph engine admits three executors and this worker now provides all
 * three: MODEL nodes go through the subscription CLI, DETERMINISTIC nodes
 * through the engine's own reducers, and ANCHOR nodes through
 * lib/worker/anchor-node-executor.ts — observations, not actions. Full
 * Lifecycle v2 IMPLEMENT and REVIEW anchors read its durable Phase 1C bridge;
 * TEST reads required CI for that bridge's exact produced commit; DEPLOY
 * verifies the Vercel-bot Production deployment for its exact merge commit
 * and base branch; and MONITOR probes only its exact recorded deployment URL.
 * No checkout SHA, branch, or ambient URL may substitute for that lineage.
 * The worker still cannot merge or create a deployment; the lifecycle's HUMAN
 * gates remain the authority boundaries.
 *
 * The claim is matched against this list server-side, so a graph containing a
 * node this worker cannot run is never claimed and never spends a run.
 *
 * Both halves read this constant, so the set cannot drift apart.
 */
export const WORKER_SUPPORTED_EXECUTORS = ["DETERMINISTIC", "MODEL", "ANCHOR"] as const;

export type WorkerSupportedExecutor = (typeof WORKER_SUPPORTED_EXECUTORS)[number];
