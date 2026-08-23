import { SDLC_LIFECYCLE, type SdlcStage } from "@/lib/sdlc/lifecycle";
import { summariseRunStages } from "@/lib/graph/stage-summary";

/**
 * The eight stages across every run, rather than within one.
 *
 * `summariseRunStages` answers "how far through the lifecycle did *this* run
 * get?" — and deliberately omits stages a run never contained, because
 * "DEPLOYMENT 0/0" on an audit graph invents a stage that graph was never
 * going to enter. This answers the different question a person asks after the
 * third failure: "which stage do runs keep dying at?"
 *
 * Here the full eight *are* listed, and that is not a contradiction of the
 * rule above. Across a portfolio, "no run has ever reached DEPLOYMENT" is
 * itself the finding; within one run it would have been noise.
 *
 * Built on `summariseRunStages` rather than beside it. A second grouping of
 * the same rows would be a second answer to the same question, and the two
 * would eventually disagree.
 */

export type SummarisableRun = Readonly<{
  graphRunId: string;
  goal?: string | null;
  state?: string | null;
  nodes?: readonly { state: string; lifecycle_stage?: string | null; error_message?: string | null }[] | null;
}>;

export type StagePortfolioEntry = Readonly<{
  stage: SdlcStage;
  produces: string;
  /** Runs with at least one node in this stage. */
  runsTouched: number;
  /** Runs where this stage has a failed node. */
  runsFailed: number;
  /** Runs where this stage has work started and not settled. */
  runsActive: number;
  /** Runs where every node in this stage completed. */
  runsComplete: number;
  nodesTotal: number;
  nodesFailed: number;
  /**
   * Failed runs over runs touched, 0-100, or null when nothing reached it.
   * Null rather than 0: "never run" and "never failed" are different facts,
   * and a rate showing both as zero hides one of them.
   */
  failureRatePercent: number | null;
  /** The most recent error seen in this stage, for a reader to act on. */
  latestError: string | null;
}>;

export type StagePortfolio = Readonly<{
  entries: readonly StagePortfolioEntry[];
  runsConsidered: number;
  /** Runs carrying no recognised stage at all — they predate the rule. */
  runsUnstaged: number;
  /** The stage failing in the most runs, or null when nothing has failed. */
  weakestStage: SdlcStage | null;
}>;

export function buildStagePortfolio(runs: readonly SummarisableRun[]): StagePortfolio {
  const tally = new Map<SdlcStage, {
    runsTouched: number; runsFailed: number; runsActive: number; runsComplete: number;
    nodesTotal: number; nodesFailed: number; latestError: string | null;
  }>();
  for (const definition of SDLC_LIFECYCLE) {
    tally.set(definition.stage, {
      runsTouched: 0, runsFailed: 0, runsActive: 0, runsComplete: 0,
      nodesTotal: 0, nodesFailed: 0, latestError: null,
    });
  }

  let runsUnstaged = 0;

  for (const run of runs) {
    const nodes = run.nodes ?? [];
    const { stages } = summariseRunStages(nodes);
    if (stages.length === 0) {
      runsUnstaged += 1;
      continue;
    }
    for (const stage of stages) {
      const entry = tally.get(stage.stage);
      if (!entry) continue;
      entry.runsTouched += 1;
      entry.nodesTotal += stage.total;
      entry.nodesFailed += stage.failed;
      if (stage.failed > 0) entry.runsFailed += 1;
      else if (stage.active > 0) entry.runsActive += 1;
      else if (stage.completed === stage.total) entry.runsComplete += 1;

      if (!entry.latestError) {
        // Runs arrive newest-first, so the first error seen is the latest.
        const failed = nodes.find(
          (node) => node.lifecycle_stage === stage.stage && node.error_message,
        );
        entry.latestError = failed?.error_message ?? null;
      }
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

  return Object.freeze({ entries, runsConsidered: runs.length, runsUnstaged, weakestStage });
}
