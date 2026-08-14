import type { CompiledNode } from "@/lib/graph/compiler";
import { resourceKey } from "@/lib/graph/types";

/**
 * Fanning parallel nodes out onto isolated workspaces.
 *
 * Two nodes editing the same checkout at once corrupt each other's work in a
 * way that is very hard to see afterwards: the branch still builds, the tests
 * still pass, and one agent's change is simply gone. Isolation is what makes
 * parallel implementation safe, and the isolation has to be decided *before*
 * anything runs rather than discovered when a diff looks wrong.
 *
 * The allocation rule is narrow on purpose:
 *
 * - **A node that writes gets its own workspace.** Always, even if nothing else
 *   is running — a node that writes into a shared checkout is a landmine for
 *   whatever runs next.
 * - **Nodes that only read share one.** A read-only node cannot disturb
 *   anything, and giving each one a clone would multiply setup cost for no
 *   safety at all.
 * - **Allocation is bounded.** Workspaces cost disk and setup time, so the
 *   number in flight is capped and the scheduler waits rather than allocating
 *   without limit.
 *
 * As with locks, acquisition is injected. The decision of *who needs what* is
 * pure and testable; the git clone behind it needs a token and a network.
 */

export type Workspace = {
  readonly workspaceId: string;
  readonly directory: string;
  /** The branch this workspace is working on, when it has one. */
  readonly branch: string | null;
};

export type WorkspaceAcquirer = (request: {
  readonly nodeKey: string;
  readonly writable: boolean;
}) => Promise<Workspace>;

export type WorkspaceReleaser = (workspace: Workspace) => Promise<void>;

export const WORKSPACE_MODES = ["ISOLATED", "SHARED_READ_ONLY", "NONE"] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export type WorkspacePlan = {
  readonly nodeKey: string;
  readonly mode: WorkspaceMode;
  readonly reason: string;
};

/**
 * Decide what each node needs before any of them run.
 *
 * Returned as a plan rather than applied directly so it can be shown in the
 * execution summary — "three nodes will each get their own checkout" is exactly
 * the kind of thing a person should be able to see before agreeing to a run.
 */
export function planWorkspaces(nodes: readonly CompiledNode[]): readonly WorkspacePlan[] {
  return nodes.map((node) => {
    if (node.writes.length > 0) {
      return {
        nodeKey: node.nodeKey,
        mode: "ISOLATED" as const,
        reason: `Writes ${node.writes.map(resourceKey).join(", ")}, so it needs a checkout nothing else is editing.`,
      };
    }

    if (node.reads.length > 0) {
      return {
        nodeKey: node.nodeKey,
        mode: "SHARED_READ_ONLY" as const,
        reason: "Only reads, so a shared checkout is safe and cheaper than a clone.",
      };
    }

    return {
      nodeKey: node.nodeKey,
      mode: "NONE" as const,
      reason: "Touches no repository resource, so it needs no checkout at all.",
    };
  });
}

/** How many isolated workspaces a node set would need at full width. */
export function isolatedWorkspaceCount(nodes: readonly CompiledNode[]): number {
  return planWorkspaces(nodes).filter((plan) => plan.mode === "ISOLATED").length;
}

export const FAN_OUT_OUTCOMES = ["ALLOCATED", "DEFERRED", "FAILED"] as const;
export type FanOutOutcome = (typeof FAN_OUT_OUTCOMES)[number];

export type FanOutAllocation = {
  readonly outcome: FanOutOutcome;
  /** Workspace per node key. Absent for nodes needing none. */
  readonly assigned: ReadonlyMap<string, Workspace>;
  /** Nodes that must wait because the workspace ceiling was reached. */
  readonly deferred: readonly string[];
  readonly detail: string;
};

export type FanOutLimits = {
  /**
   * Ceiling on isolated workspaces in flight. Each one is a checkout, so this
   * bounds disk and setup cost rather than being a concurrency preference.
   */
  readonly maxIsolatedWorkspaces: number;
};

/**
 * Allocate workspaces for a batch, or defer the ones that do not fit.
 *
 * Deferring is deliberate: running a writing node without isolation because the
 * ceiling was reached would trade a bounded delay for silent corruption, which
 * is never the right trade. A deferred node is simply scheduled later.
 */
export async function allocateWorkspaces(
  nodes: readonly CompiledNode[],
  acquire: WorkspaceAcquirer,
  release: WorkspaceReleaser,
  limits: FanOutLimits,
): Promise<FanOutAllocation> {
  const plans = planWorkspaces(nodes);
  const assigned = new Map<string, Workspace>();
  const deferred: string[] = [];
  const taken: Workspace[] = [];

  let isolatedTaken = 0;
  let sharedReadOnly: Workspace | null = null;

  try {
    for (const plan of plans) {
      if (plan.mode === "NONE") continue;

      if (plan.mode === "SHARED_READ_ONLY") {
        // One shared checkout serves every reader in the batch.
        sharedReadOnly ??= await (async () => {
          const workspace = await acquire({ nodeKey: plan.nodeKey, writable: false });
          taken.push(workspace);
          return workspace;
        })();
        assigned.set(plan.nodeKey, sharedReadOnly);
        continue;
      }

      if (isolatedTaken >= limits.maxIsolatedWorkspaces) {
        deferred.push(plan.nodeKey);
        continue;
      }

      const workspace = await acquire({ nodeKey: plan.nodeKey, writable: true });
      taken.push(workspace);
      assigned.set(plan.nodeKey, workspace);
      isolatedTaken += 1;
    }
  } catch (error) {
    // All or nothing within a batch: a half-allocated fan-out leaves workspaces
    // held by nodes that will never run.
    await releaseWorkspaces(taken, release);
    const message = error instanceof Error ? error.message : String(error);
    return {
      outcome: "FAILED",
      assigned: new Map(),
      deferred: [],
      detail: `Workspace allocation failed: ${message}`,
    };
  }

  if (deferred.length > 0) {
    return {
      outcome: "DEFERRED",
      assigned,
      deferred,
      detail:
        `${deferred.length} node(s) wait for a workspace: the ceiling of ` +
        `${limits.maxIsolatedWorkspaces} isolated checkout(s) is reached. ` +
        "Running them unisolated would risk one branch overwriting another.",
    };
  }

  return {
    outcome: "ALLOCATED",
    assigned,
    deferred: [],
    detail:
      isolatedTaken === 0 && sharedReadOnly === null
        ? "No node in this batch needs a checkout."
        : `${isolatedTaken} isolated workspace(s)${sharedReadOnly ? " plus one shared read-only checkout" : ""}.`,
  };
}

/**
 * Give the workspaces back.
 *
 * A failed release must not fail the node whose work already succeeded — the
 * workspace is reclaimable by other means, and losing a completed result to a
 * cleanup error would be the worse outcome.
 */
export async function releaseWorkspaces(
  workspaces: readonly Workspace[],
  release: WorkspaceReleaser,
): Promise<void> {
  // Distinct only: readers share one workspace, and releasing it once per
  // reader would double-free it.
  const seen = new Set<string>();
  for (const workspace of [...workspaces].reverse()) {
    if (seen.has(workspace.workspaceId)) continue;
    seen.add(workspace.workspaceId);
    try {
      await release(workspace);
    } catch {
      // Intentionally swallowed. See the note above.
    }
  }
}
