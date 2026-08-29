// @vitest-environment node

import { describe, expect, it } from "vitest";

import { layoutTrail } from "@/lib/graph/trail-layout";

/**
 * The trail map's obligations: dependency depth becomes the column, order is
 * deterministic, unknown edges are dropped rather than crashing, and a
 * feedback cycle never traps the layout.
 */

describe("layoutTrail", () => {
  it("layers a diamond by longest path", () => {
    const layout = layoutTrail(
      ["goal", "scan_a", "scan_b", "merge"],
      [
        { from: "goal", to: "scan_a" },
        { from: "goal", to: "scan_b" },
        { from: "scan_a", to: "merge" },
        { from: "scan_b", to: "merge" },
      ],
    );
    const columnOf = Object.fromEntries(layout.nodes.map((n) => [n.nodeKey, n.column]));
    expect(columnOf).toEqual({ goal: 0, scan_a: 1, scan_b: 1, merge: 2 });
    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(2);
  });

  it("uses the longest path, not the shortest, so arrows always point forward", () => {
    const layout = layoutTrail(
      ["a", "b", "c"],
      [
        { from: "a", to: "c" }, // short path would put c in column 1
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    );
    const columnOf = Object.fromEntries(layout.nodes.map((n) => [n.nodeKey, n.column]));
    expect(columnOf.c).toBe(2);
  });

  it("is deterministic: same input, same order, alphabetical within a column", () => {
    const first = layoutTrail(["zeta", "alpha", "mid"], [{ from: "alpha", to: "mid" }]);
    const second = layoutTrail(["mid", "zeta", "alpha"], [{ from: "alpha", to: "mid" }]);
    expect(first).toEqual(second);
    const columnZero = first.nodes.filter((n) => n.column === 0).map((n) => n.nodeKey);
    expect(columnZero).toEqual(["alpha", "zeta"]);
  });

  it("drops edges naming unknown nodes instead of crashing", () => {
    const layout = layoutTrail(["a"], [{ from: "a", to: "ghost" }, { from: "ghost", to: "a" }]);
    expect(layout.edges).toEqual([]);
    expect(layout.nodes).toEqual([{ nodeKey: "a", column: 0, row: 0 }]);
  });

  it("tolerates a cycle: every node still gets a column", () => {
    const layout = layoutTrail(
      ["build", "review", "test"],
      [
        { from: "build", to: "review" },
        { from: "review", to: "test" },
        { from: "test", to: "build" }, // feedback edge
      ],
    );
    expect(layout.nodes).toHaveLength(3);
    const columns = new Set(layout.nodes.map((n) => n.column));
    expect(columns.size).toBeGreaterThanOrEqual(1);
  });

  it("handles the empty graph", () => {
    const layout = layoutTrail([], []);
    expect(layout).toEqual({ nodes: [], columns: 0, rows: 0, edges: [] });
  });
});
