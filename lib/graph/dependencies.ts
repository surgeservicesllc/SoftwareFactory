import type { NodeContract } from "@/lib/graph/contracts";
import {
  type EdgeReason,
  type GraphEdge,
  type ResourceRef,
  resourceKey,
} from "@/lib/graph/types";

/**
 * Dependency analysis, and the fake-edge test.
 *
 * A proposed edge A→B is only real if B actually consumes something A produces:
 * B's input comes from A's output, or B reads a resource A writes, or B is
 * verifying A, or a policy demands the order. Anything else is a **fake edge** —
 * an ordering someone imagined, usually because the steps were described in a
 * sentence and sentences are sequential. Fake edges are the main reason graphs
 * run slowly for no reason, so they are removed and the nodes run in parallel.
 *
 * The other half of the job is the opposite failure: edges nobody proposed but
 * the work requires. Two nodes writing the same file are not independent even
 * if neither reads the other's output. Those are discovered from the declared
 * resources rather than from the proposed edges.
 */

export type ProposedEdge = {
  readonly from: string;
  readonly to: string;
  /** Optional hint from the planner; still checked rather than trusted. */
  readonly reason?: EdgeReason;
  readonly detail?: string;
};

export type RemovedEdge = {
  readonly from: string;
  readonly to: string;
  readonly why: string;
};

export type DependencyAnalysis = {
  /** Edges that survived, each carrying why it is real. */
  readonly edges: readonly GraphEdge[];
  /** Proposed edges that were not justified, with the reason for removal. */
  readonly removed: readonly RemovedEdge[];
  /** Edges the work requires that nobody proposed. */
  readonly discovered: readonly GraphEdge[];
  /** Pairs writing the same resource, which must be serialized or locked. */
  readonly writeConflicts: readonly WriteConflict[];
};

export type WriteConflict = {
  readonly nodes: readonly [string, string];
  readonly resource: ResourceRef;
};

function overlap(a: readonly ResourceRef[], b: readonly ResourceRef[]): ResourceRef[] {
  const bKeys = new Set(b.map(resourceKey));
  return a.filter((resource) => bKeys.has(resourceKey(resource)));
}

/**
 * Does B's declared input reference A's node id?
 *
 * The convention is that a node consuming another node's output names it in
 * `dependsOn`. That is the planner's claim; this function is what turns the
 * claim into a justified edge, and its absence is what exposes a fake one.
 */
function consumesOutput(from: NodeContract, to: NodeContract): boolean {
  return to.dependsOn.includes(from.nodeId);
}

export function analyzeDependencies(
  nodes: readonly NodeContract[],
  proposed: readonly ProposedEdge[],
): DependencyAnalysis {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const edges: GraphEdge[] = [];
  const removed: RemovedEdge[] = [];
  const discovered: GraphEdge[] = [];
  const writeConflicts: WriteConflict[] = [];
  const kept = new Set<string>();

  const keyOf = (from: string, to: string) => `${from}->${to}`;

  for (const edge of proposed) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);

    if (!from || !to) {
      removed.push({
        from: edge.from,
        to: edge.to,
        why: "One or both nodes are not in the graph.",
      });
      continue;
    }

    // A policy edge is accepted on the planner's word, because its whole
    // purpose is to impose an order the data does not require.
    if (edge.reason === "POLICY") {
      edges.push({
        from: edge.from,
        to: edge.to,
        reason: "POLICY",
        detail: edge.detail ?? "Required by policy rather than by data flow.",
      });
      kept.add(keyOf(edge.from, edge.to));
      continue;
    }

    if (to.capability === "review" || to.capability === "security_review") {
      if (consumesOutput(from, to)) {
        edges.push({
          from: edge.from,
          to: edge.to,
          reason: "VERIFICATION",
          detail: `${to.nodeId} verifies ${from.nodeId}, so it cannot start before there is something to verify.`,
        });
        kept.add(keyOf(edge.from, edge.to));
        continue;
      }
    }

    if (consumesOutput(from, to)) {
      edges.push({
        from: edge.from,
        to: edge.to,
        reason: "DATA",
        detail: `${to.nodeId} declares ${from.nodeId} in dependsOn, so its input is populated from that output.`,
      });
      kept.add(keyOf(edge.from, edge.to));
      continue;
    }

    const readAfterWrite = overlap(to.reads, from.writes);
    if (readAfterWrite.length > 0) {
      edges.push({
        from: edge.from,
        to: edge.to,
        reason: "RESOURCE_READ_AFTER_WRITE",
        detail: `${to.nodeId} reads ${readAfterWrite
          .map(resourceKey)
          .join(", ")}, which ${from.nodeId} writes.`,
      });
      kept.add(keyOf(edge.from, edge.to));
      continue;
    }

    // Nothing justified it. This is the fake edge the spec asks us to find.
    removed.push({
      from: edge.from,
      to: edge.to,
      why: `${edge.to} does not consume ${edge.from}'s output and does not read anything it writes, so the two can run in parallel.`,
    });
  }

  // Now the edges the work requires but nobody proposed.
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = 0; j < nodes.length; j += 1) {
      if (i === j) continue;
      const from = nodes[i];
      const to = nodes[j];

      const readAfterWrite = overlap(to.reads, from.writes);
      if (
        readAfterWrite.length > 0 &&
        !kept.has(keyOf(from.nodeId, to.nodeId)) &&
        !kept.has(keyOf(to.nodeId, from.nodeId))
      ) {
        const edge: GraphEdge = {
          from: from.nodeId,
          to: to.nodeId,
          reason: "RESOURCE_READ_AFTER_WRITE",
          detail: `Hidden dependency: ${to.nodeId} reads ${readAfterWrite
            .map(resourceKey)
            .join(", ")}, which ${from.nodeId} writes.`,
        };
        discovered.push(edge);
        edges.push(edge);
        kept.add(keyOf(from.nodeId, to.nodeId));
      }

      // Write/write is a conflict, not an ordering: neither node needs the
      // other, they simply cannot both proceed. Report each pair once.
      if (i < j) {
        for (const resource of overlap(from.writes, to.writes)) {
          writeConflicts.push({
            nodes: [from.nodeId, to.nodeId],
            resource,
          });
        }
      }
    }
  }

  return { edges, removed, discovered, writeConflicts };
}

/**
 * Find a cycle, if there is one.
 *
 * Returned as the offending path rather than a boolean, because "these three
 * nodes wait on each other" is actionable and "true" is not.
 */
export function findCycle(
  nodes: readonly NodeContract[],
  edges: readonly GraphEdge[],
): readonly string[] | null {
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) outgoing.set(node.nodeId, []);
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to);

  const visiting = new Set<string>();
  const done = new Set<string>();
  const path: string[] = [];

  function walk(id: string): readonly string[] | null {
    if (done.has(id)) return null;
    if (visiting.has(id)) return [...path.slice(path.indexOf(id)), id];

    visiting.add(id);
    path.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    done.add(id);
    return null;
  }

  for (const node of nodes) {
    const cycle = walk(node.nodeId);
    if (cycle) return cycle;
  }
  return null;
}

/** Longest chain of dependent nodes — the graph's sequential depth. */
export function criticalPath(
  nodes: readonly NodeContract[],
  edges: readonly GraphEdge[],
): readonly string[] {
  const incoming = new Map<string, string[]>();
  for (const node of nodes) incoming.set(node.nodeId, []);
  for (const edge of edges) incoming.get(edge.to)?.push(edge.from);

  const memo = new Map<string, readonly string[]>();

  function longestTo(id: string): readonly string[] {
    const cached = memo.get(id);
    if (cached) return cached;

    // Guard against a cycle: memoize a stub before recursing.
    memo.set(id, [id]);
    let best: readonly string[] = [];
    for (const parent of incoming.get(id) ?? []) {
      const candidate = longestTo(parent);
      if (candidate.length > best.length) best = candidate;
    }
    const result = [...best, id];
    memo.set(id, result);
    return result;
  }

  let longest: readonly string[] = [];
  for (const node of nodes) {
    const candidate = longestTo(node.nodeId);
    if (candidate.length > longest.length) longest = candidate;
  }
  return longest;
}
