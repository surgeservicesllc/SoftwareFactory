/**
 * Deterministic layout for the Agent Trail map: nodes into dependency
 * columns, edges into drawable segments.
 *
 * The visual language is adapted from agenttrail (github.com/sodiumsun/
 * agenttrail, MIT © 2026 Kelly Sun): components as cards, dependency arrows,
 * honest state colors, the live run sitting on the node it is touching. The
 * data underneath is entirely this factory's own — graph nodes, edges, and
 * states as the database records them — so nothing here invents progress.
 *
 * Pure and framework-free so the layering logic is unit-testable: Kahn
 * layering by longest path from the roots, stable alphabetical order within
 * a column, and cycle tolerance (a feedback edge never traps the layout —
 * any node left unplaced by the acyclic pass lands one column after the
 * deepest of its placed dependencies).
 */

export type TrailNode = {
  readonly nodeKey: string;
  /** Grid position: column = dependency depth, row = index within column. */
  readonly column: number;
  readonly row: number;
};

export type TrailEdge = {
  readonly from: string;
  readonly to: string;
};

export type TrailLayout = {
  readonly nodes: readonly TrailNode[];
  readonly columns: number;
  readonly rows: number;
  readonly edges: readonly TrailEdge[];
};

export function layoutTrail(
  nodeKeys: readonly string[],
  edges: readonly { from: string; to: string }[],
): TrailLayout {
  const keys = [...new Set(nodeKeys)].sort();
  const keySet = new Set(keys);
  // Only edges between known nodes participate; a stale edge cannot crash
  // the board.
  const usable = edges.filter((edge) => keySet.has(edge.from) && keySet.has(edge.to));

  const incoming = new Map<string, string[]>(keys.map((key) => [key, []]));
  const outgoing = new Map<string, string[]>(keys.map((key) => [key, []]));
  for (const edge of usable) {
    incoming.get(edge.to)!.push(edge.from);
    outgoing.get(edge.from)!.push(edge.to);
  }

  // Longest-path layering via Kahn's algorithm.
  const depth = new Map<string, number>();
  const remaining = new Map(keys.map((key) => [key, incoming.get(key)!.length]));
  let frontier = keys.filter((key) => remaining.get(key) === 0);
  frontier.forEach((key) => depth.set(key, 0));
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const target of outgoing.get(key)!) {
        depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(key) ?? 0) + 1));
        const left = remaining.get(target)! - 1;
        remaining.set(target, left);
        if (left === 0) next.push(target);
      }
    }
    frontier = next.sort();
  }

  // Cycle tolerance: place anything Kahn could not reach one column past the
  // deepest placed dependency it has (or column 0 with no placed ones).
  for (const key of keys) {
    if (!depth.has(key)) {
      const placed = incoming.get(key)!.map((from) => depth.get(from)).filter(
        (value): value is number => value !== undefined,
      );
      depth.set(key, placed.length > 0 ? Math.max(...placed) + 1 : 0);
    }
  }

  const byColumn = new Map<number, string[]>();
  for (const key of keys) {
    const column = depth.get(key)!;
    byColumn.set(column, [...(byColumn.get(column) ?? []), key]);
  }

  const nodes: TrailNode[] = [];
  let rows = 0;
  const columns = byColumn.size === 0 ? 0 : Math.max(...byColumn.keys()) + 1;
  for (const [column, members] of byColumn) {
    members.sort();
    members.forEach((nodeKey, row) => nodes.push({ nodeKey, column, row }));
    rows = Math.max(rows, members.length);
  }
  nodes.sort((a, b) => a.column - b.column || a.row - b.row);

  return { nodes, columns, rows, edges: usable };
}
