import { SDLC_LIFECYCLE, type SdlcStage } from "@/lib/sdlc/lifecycle";
import {
  summariseRunByStage,
  type StageStatus,
  type SummarisableNode,
} from "@/lib/sdlc/run-summary";

/**
 * The eight stages across every run, rather than within one.
 *
 * `summariseRunByStage` answers "where is this run?". This answers the
 * question a person actually asks after the third failure: "which stage do
 * runs keep dying at?" Both are derived from the same node arrays, so the
 * per-run rail and this rollup cannot tell different stories.
 *
 * Pure, and over runs the caller already holds. No new endpoint and no new
 * schema — the stage column and `/api/graphs/runs` were already enough; what
 * was missing was somebody reading them this way.
 */

export type SummarisableRun = Readonly<{
  graphRunId: string;
  goal?: string | null;
  state?: string | null;
  nodes?: readonly SummarisableNode[] | null;
}>;

export type StagePortfolioEntry = Readonly<{
  stage: SdlcStage;
  produces: string;
  /** Runs that have at least one node in this stage. */
  runsTouched: number;
  /** Runs where this stage is the one needing attention right now. */
  runsCurrent: number;
  /** Runs where this stage failed. */
  runsFailed: number;
  /** Runs where this stage is waiting on a person. */
  runsAwaitingDecision: number;
  /** Runs where every node in this stage succeeded. */
  runsComplete: number;
  nodesTotal: number;
  nodesFailed: number;
  /**
   * Failed runs over runs touched, 0-100, or null when nothing reached it.
   * Null rather than 0 on purpose: "never run" and "never failed" are
   * different facts and a chart that shows both as zero hides one of them.
   */
  failureRatePercent: number | null;
  /** The most recent error seen in this stage, for a reader to act on. */
  latestError: string | null;
}>;

export type StagePortfolio = Readonly<{
  entries: readonly StagePortfolioEntry[];
  runsConsidered: number;
  /** Runs carrying no staged node at all — they predate the stage rule. */
  runsUnstaged: number;
  /** The stage failing in the most runs, or null when nothing has failed. */
  weakestStage: SdlcStage | null;
}>;

export function buildStagePortfolio(runs: readonly SummarisableRun[]): StagePortfolio {
  const tally = new Map<SdlcStage, {
    runsTouched: number; runsCurrent: number; runsFailed: number;
    runsAwaitingDecision: number; runsComplete: number;
    nodesTotal: number; nodesFailed: number; latestError: string | null;
  }>();
  for (const definition of SDLC_LIFECYCLE) {
    tally.set(definition.stage, {
      runsTouched: 0, runsCurrent: 0, runsFailed: 0,
      runsAwaitingDecision: 0, runsComplete: 0,
      nodesTotal: 0, nodesFailed: 0, latestError: null,
    });
  }

  let runsUnstaged = 0;

  for (const run of runs) {
    const summary = summariseRunByStage(run.nodes ?? []);
    if (summary.stagesWithWork === 0) {
      runsUnstaged += 1;
      continue;
    }
    for (const stage of summary.stages) {
      const entry = tally.get(stage.stage);
      if (!entry) continue;
      entry.nodesTotal += stage.total;
      entry.nodesFailed += stage.failed;
      if (stage.total > 0) entry.runsTouched += 1;
      if (summary.currentStage === stage.stage) entry.runsCurrent += 1;

      const status: StageStatus = stage.status;
      if (status === "FAILED") entry.runsFailed += 1;
      if (status === "AWAITING_DECISION") entry.runsAwaitingDecision += 1;
      if (status === "COMPLETE") entry.runsComplete += 1;
      // Runs arrive newest-first from the API, so the first error seen is the
      // latest one. Keeping the first keeps that ordering meaningful.
      if (!entry.latestError && stage.firstError) entry.latestError = stage.firstError;
    }
  }

  const entries = SDLC_LIFECYCLE.map((definition) => {
    const counts = tally.get(definition.stage)!;
    return Object.freeze({
      stage: definition.stage,
      produces: definition.produces,
      ...counts,
      failureRatePercent: counts.runsTouched > 0
        ? Math.round((counts.runsFailed / counts.runsTouched) * 100)
        : null,
    });
  });

  const failing = entries.filter((entry) => entry.runsFailed > 0);
  const weakestStage = failing.length > 0
    ? failing.reduce((worst, entry) => (entry.runsFailed > worst.runsFailed ? entry : worst)).stage
    : null;

  return Object.freeze({
    entries,
    runsConsidered: runs.length,
    runsUnstaged,
    weakestStage,
  });
}
