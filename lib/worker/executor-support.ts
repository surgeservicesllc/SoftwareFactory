/**
 * What this worker can actually execute.
 *
 * The graph engine admits three executors. This worker provides two of them:
 * MODEL nodes go through the subscription CLI, DETERMINISTIC nodes through the
 * engine's own reducers. ANCHOR nodes are evidence-producing work — run the
 * tests, attempt the reproduction — and need a workspace with real command
 * execution, which the read-only analysis lane deliberately does not have.
 *
 * The claim is matched against this list server-side, so a graph containing a
 * node this worker cannot run is never claimed and never spends a run. The
 * dispatcher in scripts/graph-worker.mts still refuses ANCHOR work in-band:
 * the claim filter is the fix, that refusal is the floor under it, and it stays
 * reachable while an older database still holds the unfiltered claim function.
 *
 * Both halves read this constant, so the set cannot drift apart.
 */
export const WORKER_SUPPORTED_EXECUTORS = ["DETERMINISTIC", "MODEL"] as const;

export type WorkerSupportedExecutor = (typeof WORKER_SUPPORTED_EXECUTORS)[number];
