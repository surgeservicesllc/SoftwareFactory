import { SDLC_STAGES, type SdlcStage } from "@/lib/sdlc/lifecycle";

/**
 * A run's nodes, grouped by the lifecycle stage they sit in.
 *
 * The graph-runs panel lists nodes in dependency order, which answers "what ran"
 * but not "how far through the lifecycle this got". Every node now carries a
 * stage — declared by its template or derived from its capability, and
 * backfilled for the graphs that predate the rule — so the grouping is a read
 * of stored state rather than a second model of it.
 *
 * Deliberately not a progress percentage. A stage with three completed nodes
 * and one failed is not 75% of anything a person can act on; the counts say
 * what happened and the caller decides how to show it.
 */
export type StageSummary = {
  readonly stage: SdlcStage;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  /** Running or verifying: work that has started and not settled. */
  readonly active: number;
  /** Skipped or blocked: settled without doing the work. */
  readonly skipped: number;
};

type StageBearingNode = {
  readonly state: string;
  readonly lifecycle_stage?: string | null;
};

function isStage(value: string | null | undefined): value is SdlcStage {
  return typeof value === "string" && (SDLC_STAGES as readonly string[]).includes(value);
}

/**
 * Summarise in lifecycle order, and only over stages this run actually has.
 *
 * A stage the run never contained is absent rather than zeroed: a row reading
 * "DEPLOYMENT 0/0" on an audit graph would invent a stage the graph was never
 * going to enter. A node whose stage the database does not recognise — the
 * column is text, and a row can predate a vocabulary — is counted nowhere, and
 * `unstaged` says how many so the caller can be honest about the shortfall
 * instead of quietly dropping them.
 */
export function summariseRunStages(
  nodes: readonly StageBearingNode[],
): { readonly stages: readonly StageSummary[]; readonly unstaged: number } {
  const byStage = new Map<SdlcStage, { total: number; completed: number; failed: number; active: number; skipped: number }>();
  let unstaged = 0;

  for (const node of nodes) {
    if (!isStage(node.lifecycle_stage)) {
      unstaged += 1;
      continue;
    }
    const bucket = byStage.get(node.lifecycle_stage)
      ?? { total: 0, completed: 0, failed: 0, active: 0, skipped: 0 };
    bucket.total += 1;
    if (node.state === "COMPLETED") bucket.completed += 1;
    else if (node.state === "FAILED") bucket.failed += 1;
    else if (node.state === "RUNNING" || node.state === "VERIFYING") bucket.active += 1;
    else if (node.state === "SKIPPED" || node.state === "BLOCKED") bucket.skipped += 1;
    byStage.set(node.lifecycle_stage, bucket);
  }

  const stages = SDLC_STAGES
    .filter((stage) => byStage.has(stage))
    .map((stage) => ({ stage, ...byStage.get(stage)! }));

  return { stages, unstaged };
}
