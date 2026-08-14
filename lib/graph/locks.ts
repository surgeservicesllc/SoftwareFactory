import type { CompiledNode } from "@/lib/graph/compiler";
import { resourceKey, type ResourceRef } from "@/lib/graph/types";

/**
 * Lock coordination.
 *
 * `dependencies.ts` finds which nodes contend for a resource; the database
 * enforces one holder per resource. This is the layer between them: it decides
 * which locks a node needs, in what order to take them, and what to do when one
 * is unavailable.
 *
 * Ordering is the part that matters. Two nodes each holding one of the two
 * resources the other wants will wait forever, and no amount of retrying fixes
 * it. Acquiring in a globally consistent order makes that deadlock impossible
 * rather than unlikely — the second node fails to get the *first* lock and
 * simply waits, holding nothing.
 *
 * As everywhere else in the graph engine, the actual acquisition is injected,
 * so this reasoning is testable without a database.
 */

export type LockHandle = {
  readonly lockId: string;
  readonly resource: ResourceRef;
};

export type LockAcquirer = (resource: ResourceRef) => Promise<LockHandle>;
export type LockReleaser = (handle: LockHandle) => Promise<void>;

export const LOCK_OUTCOMES = ["ACQUIRED", "CONTENDED", "FAILED"] as const;
export type LockOutcome = (typeof LOCK_OUTCOMES)[number];

export type LockAcquisition = {
  readonly outcome: LockOutcome;
  readonly held: readonly LockHandle[];
  /** The resource that could not be taken, when the outcome is not ACQUIRED. */
  readonly blockedOn: ResourceRef | null;
  readonly detail: string;
};

/**
 * The order every node must take locks in.
 *
 * Any total order prevents deadlock; this one sorts by `kind:id` because it is
 * stable, obvious in a log, and independent of the order a planner happened to
 * list the resources in.
 */
export function lockOrder(resources: readonly ResourceRef[]): readonly ResourceRef[] {
  return [...resources].sort((a, b) => resourceKey(a).localeCompare(resourceKey(b)));
}

/** Resources a node must hold before it may run: everything it writes. */
export function requiredLocks(node: CompiledNode): readonly ResourceRef[] {
  return lockOrder(node.writes);
}

/**
 * Take every lock a node needs, or none of them.
 *
 * All-or-nothing on purpose. A node holding half its locks while it waits for
 * the rest is the state that produces deadlock, so a failure to acquire
 * releases what was already taken and reports what it was blocked on.
 */
export async function acquireNodeLocks(
  node: CompiledNode,
  acquire: LockAcquirer,
  release: LockReleaser,
): Promise<LockAcquisition> {
  const wanted = requiredLocks(node);
  const held: LockHandle[] = [];

  for (const resource of wanted) {
    try {
      held.push(await acquire(resource));
    } catch (error) {
      // Give back everything already taken before reporting, so a blocked node
      // never keeps another one waiting.
      for (const handle of held.reverse()) {
        try {
          await release(handle);
        } catch {
          // Best effort. The lease expiry is the backstop: a lock whose holder
          // cannot release it is reclaimed rather than held forever.
        }
      }

      const message = error instanceof Error ? error.message : String(error);
      const contended = message.includes("resource_locked");

      return {
        outcome: contended ? "CONTENDED" : "FAILED",
        held: [],
        blockedOn: resource,
        detail: contended
          ? `${node.nodeKey} is waiting for ${resourceKey(resource)}, which another node holds.`
          : `${node.nodeKey} could not acquire ${resourceKey(resource)}: ${message}`,
      };
    }
  }

  return {
    outcome: "ACQUIRED",
    held,
    blockedOn: null,
    detail:
      wanted.length === 0
        ? `${node.nodeKey} writes nothing and needs no locks.`
        : `${node.nodeKey} holds ${wanted.map(resourceKey).join(", ")}.`,
  };
}

export async function releaseNodeLocks(
  handles: readonly LockHandle[],
  release: LockReleaser,
): Promise<void> {
  // Reverse order, mirroring acquisition. Not required for correctness given a
  // total order, but it keeps the log readable as a stack.
  for (const handle of [...handles].reverse()) {
    try {
      await release(handle);
    } catch {
      // Swallowed for the same reason as above: expiry is the backstop, and a
      // failed release must not fail the node whose work already succeeded.
    }
  }
}

/**
 * Group nodes into waves that can safely run at once.
 *
 * Nodes whose write sets are disjoint go in the same wave. This is what lets
 * the scheduler start a batch without a lock ever being contended — contention
 * is resolved by planning rather than by collision and retry.
 */
export function planLockWaves(
  nodes: readonly CompiledNode[],
): readonly (readonly string[])[] {
  const waves: string[][] = [];
  const claimedPerWave: Set<string>[] = [];

  for (const node of nodes) {
    const keys = node.writes.map(resourceKey);

    let placed = false;
    for (let i = 0; i < waves.length; i += 1) {
      const claimed = claimedPerWave[i];
      if (keys.every((key) => !claimed.has(key))) {
        waves[i].push(node.nodeKey);
        for (const key of keys) claimed.add(key);
        placed = true;
        break;
      }
    }

    if (!placed) {
      waves.push([node.nodeKey]);
      claimedPerWave.push(new Set(keys));
    }
  }

  return waves;
}
