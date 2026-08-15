import { collectFanIn, incompletenessNotice, type NodeOutcome } from "@/lib/graph/fan-in";
import { resourceKey, type ResourceRef } from "@/lib/graph/types";

/**
 * Integration nodes.
 *
 * Parallel branches have to converge somewhere, and that somewhere is the most
 * dangerous point in a graph: it is where one agent's work silently replaces
 * another's. The rule is that convergence is **explicit** — an integration node
 * waits for the branches it declared, checks that they all actually arrived,
 * looks for conflicts, and either reconciles them or refuses.
 *
 * What it must never do is take the last writer and call it the answer.
 */

export type BranchResult = {
  readonly branchKey: string;
  readonly status: "COMPLETED" | "FAILED";
  /** Resources this branch wrote. Overlap between branches is a conflict. */
  readonly writes: readonly ResourceRef[];
  readonly output: unknown;
};

export const INTEGRATION_OUTCOMES = [
  "INTEGRATED",
  "WAITING",
  "INCOMPLETE_INPUT",
  "CONFLICT",
  "FAILED_BRANCHES",
] as const;
export type IntegrationOutcome = (typeof INTEGRATION_OUTCOMES)[number];

export type ResourceConflict = {
  readonly resource: ResourceRef;
  readonly branches: readonly string[];
};

export type IntegrationResult = {
  readonly outcome: IntegrationOutcome;
  readonly integrated: readonly BranchResult[];
  readonly missingBranches: readonly string[];
  readonly failedBranches: readonly string[];
  readonly conflicts: readonly ResourceConflict[];
  /** Present whenever the result must not be presented as whole. */
  readonly incompleteness: string | null;
  readonly detail: string;
};

export type IntegrationPolicy = {
  /**
   * Proceed with the branches that did arrive.
   *
   * Off by default. Integrating a subset and reporting success is precisely
   * the silent partial failure the fan-in guard exists to prevent, so opting
   * into it has to be a deliberate choice recorded in the plan.
   */
  readonly allowPartial?: boolean;
  /**
   * Resources where overlapping writes are expected and handled downstream —
   * an append-only log, for instance. Anything not listed is a conflict.
   */
  readonly reconcilableResources?: readonly string[];
};

export function integrateBranches(
  requiredBranches: readonly string[],
  results: readonly BranchResult[],
  policy: IntegrationPolicy = {},
): IntegrationResult {
  const outcomes: NodeOutcome<unknown>[] = results.map((branch) =>
    branch.status === "COMPLETED"
      ? { nodeId: branch.branchKey, status: "COMPLETED", items: [] }
      : { nodeId: branch.branchKey, status: "FAILED" },
  );

  const fanIn = collectFanIn(requiredBranches, outcomes);
  const notice = incompletenessNotice(fanIn);

  // Nothing has reported at all, in either direction: the branches are still
  // running. Distinct from "some are missing", which means they are done and
  // something went wrong.
  const nothingReported =
    fanIn.completedNodes.length === 0 && fanIn.failedNodes.length === 0;
  if (nothingReported && fanIn.missingNodes.length > 0) {
    return {
      outcome: "WAITING",
      integrated: [],
      missingBranches: fanIn.missingNodes,
      failedBranches: fanIn.failedNodes,
      conflicts: [],
      incompleteness: notice,
      detail: `Waiting for ${fanIn.missingNodes.length} of ${requiredBranches.length} branches.`,
    };
  }

  const completed = results.filter((branch) => branch.status === "COMPLETED");
  const conflicts = findWriteConflicts(completed, policy.reconcilableResources ?? []);

  if (conflicts.length > 0) {
    return {
      outcome: "CONFLICT",
      integrated: [],
      missingBranches: fanIn.missingNodes,
      failedBranches: fanIn.failedNodes,
      conflicts,
      incompleteness: notice,
      detail:
        `${conflicts.length} resource(s) were written by more than one branch: ` +
        conflicts
          .map((conflict) => `${resourceKey(conflict.resource)} (${conflict.branches.join(", ")})`)
          .join("; ") +
        ". Integration stops rather than letting one branch overwrite another.",
    };
  }

  if (fanIn.failedNodes.length > 0 && !policy.allowPartial) {
    return {
      outcome: "FAILED_BRANCHES",
      integrated: [],
      missingBranches: fanIn.missingNodes,
      failedBranches: fanIn.failedNodes,
      conflicts: [],
      incompleteness: notice,
      detail: `${fanIn.failedNodes.length} branch(es) failed and the policy does not allow partial integration.`,
    };
  }

  if (fanIn.missingNodes.length > 0 && !policy.allowPartial) {
    return {
      outcome: "INCOMPLETE_INPUT",
      integrated: [],
      missingBranches: fanIn.missingNodes,
      failedBranches: fanIn.failedNodes,
      conflicts: [],
      incompleteness: notice,
      detail: `${fanIn.missingNodes.length} branch(es) never reported and the policy does not allow partial integration.`,
    };
  }

  return {
    outcome: "INTEGRATED",
    integrated: completed,
    missingBranches: fanIn.missingNodes,
    failedBranches: fanIn.failedNodes,
    conflicts: [],
    // Even a permitted partial integration carries its caveat forward.
    incompleteness: notice,
    detail: notice
      ? `Integrated ${completed.length} of ${requiredBranches.length} branches under an explicit partial-integration policy.`
      : `Integrated all ${completed.length} branches with no conflicting writes.`,
  };
}

/** Resources written by more than one branch, excluding declared-reconcilable ones. */
export function findWriteConflicts(
  branches: readonly BranchResult[],
  reconcilable: readonly string[],
): readonly ResourceConflict[] {
  const writers = new Map<string, { resource: ResourceRef; branches: string[] }>();

  for (const branch of branches) {
    for (const write of branch.writes) {
      const key = resourceKey(write);
      const entry = writers.get(key);
      if (entry) entry.branches.push(branch.branchKey);
      else writers.set(key, { resource: write, branches: [branch.branchKey] });
    }
  }

  const allowed = new Set(reconcilable);
  return [...writers.entries()]
    .filter(([key, entry]) => entry.branches.length > 1 && !allowed.has(key))
    .map(([, entry]) => ({ resource: entry.resource, branches: entry.branches }));
}
