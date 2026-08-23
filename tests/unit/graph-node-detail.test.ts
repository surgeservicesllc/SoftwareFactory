import { describe, expect, it } from "vitest";

import {
  describeNode,
  formatDuration,
  nodeArtifactTotal,
  nodeElapsedMs,
  nodeQueuedMs,
  nodeStoppedReason,
  type DetailedNode,
} from "@/lib/graph/node-detail";

/**
 * The node detail, tested where a wrong answer would look right.
 *
 * Every case here is one a reader could not catch by eye: a duration invented
 * for a node that never finished, a negative interval shown as a positive one,
 * model latency passed off as wall time, a blocked node blamed for an upstream
 * node's error. Each would render as a perfectly plausible number or sentence.
 */

function node(overrides: Partial<DetailedNode> = {}): DetailedNode {
  return {
    node_key: "implement",
    state: "COMPLETED",
    queued_at: "2026-08-23T10:00:00.000Z",
    node_started_at: "2026-08-23T10:00:05.000Z",
    node_completed_at: "2026-08-23T10:01:35.000Z",
    ...overrides,
  };
}

describe("nodeElapsedMs", () => {
  it("measures the wall time between the node's own clocks", () => {
    expect(nodeElapsedMs(node())).toBe(90_000);
  });

  it("returns null for a node that started and has not finished", () => {
    // The tempting wrong answer is "now minus started", which turns a running
    // node into a number that grows every render and is not a measurement.
    expect(nodeElapsedMs(node({ node_completed_at: null, state: "RUNNING" }))).toBeNull();
  });

  it("returns null for a node that never started", () => {
    expect(nodeElapsedMs(node({ node_started_at: null, node_completed_at: null, state: "PENDING" })))
      .toBeNull();
  });

  it("returns null rather than a magnitude when the clocks disagree", () => {
    // A clock adjustment mid-run. Reporting Math.abs() here would present a
    // negative interval as a real duration.
    const backwards = node({
      node_started_at: "2026-08-23T10:01:35.000Z",
      node_completed_at: "2026-08-23T10:00:05.000Z",
    });
    expect(nodeElapsedMs(backwards)).toBeNull();
  });

  it("returns null for an unparseable timestamp instead of NaN", () => {
    expect(nodeElapsedMs(node({ node_completed_at: "not a date" }))).toBeNull();
  });

  it("does not fall back to latency_ms, which measures something else", () => {
    // latency_ms is the executor's own call time. A node that ran 90s of wall
    // time with an 800ms model call is not an 800ms node.
    const running = node({ node_completed_at: null, latency_ms: 800, state: "RUNNING" });
    expect(nodeElapsedMs(running)).toBeNull();
  });
});

describe("nodeQueuedMs", () => {
  it("measures the wait between being queued and starting", () => {
    expect(nodeQueuedMs(node())).toBe(5_000);
  });

  it("returns null for a node still waiting, rather than counting to now", () => {
    expect(nodeQueuedMs(node({ node_started_at: null, node_completed_at: null }))).toBeNull();
  });

  it("returns null when the node started before it was queued", () => {
    expect(nodeQueuedMs(node({ queued_at: "2026-08-23T10:00:10.000Z" }))).toBeNull();
  });
});

describe("formatDuration", () => {
  it("keeps sub-second work in milliseconds rather than collapsing it to 0s", () => {
    // A 4ms reducer and a 900ms one are not the same event.
    expect(formatDuration(4)).toBe("4ms");
    expect(formatDuration(900)).toBe("900ms");
  });

  it("gives one decimal to single-digit seconds and none above ten", () => {
    expect(formatDuration(1_500)).toBe("1.5s");
    expect(formatDuration(42_000)).toBe("42s");
  });

  it("never prints a sixty-second remainder", () => {
    // 3m 59.7s rounds the remainder to 60; "3m 60s" is not a duration.
    expect(formatDuration(239_700)).toBe("4m");
  });

  it("prints whole minutes without a zero remainder", () => {
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(150_000)).toBe("2m 30s");
  });

  it("returns null for null and for a negative interval", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
  });
});

describe("nodeArtifactTotal", () => {
  it("sums every kind", () => {
    expect(nodeArtifactTotal(node({ artifact_counts: { REPORT: 2, PATCH: 1 } }))).toBe(3);
  });

  it("is zero, not NaN, when the node produced nothing", () => {
    expect(nodeArtifactTotal(node({ artifact_counts: {} }))).toBe(0);
    expect(nodeArtifactTotal(node({ artifact_counts: null }))).toBe(0);
  });

  it("ignores a non-numeric count rather than propagating NaN through the sum", () => {
    const malformed = { REPORT: 2, PATCH: "one" } as unknown as Record<string, number>;
    expect(nodeArtifactTotal(node({ artifact_counts: malformed }))).toBe(2);
  });
});

describe("nodeStoppedReason", () => {
  it("prefers the block over the error, so an upstream failure is not blamed here", () => {
    // A node BLOCKED by a failed dependency carries both: its own error field
    // may hold a stale message. Showing the error would blame this node for a
    // failure that happened elsewhere.
    const blocked = node({
      state: "BLOCKED",
      blocked_reason: "Upstream node 'architecture' failed.",
      error_message: "Model call timed out.",
    });
    expect(nodeStoppedReason(blocked)).toBe("Upstream node 'architecture' failed.");
  });

  it("falls back to the error when nothing blocked the node", () => {
    expect(nodeStoppedReason(node({ state: "FAILED", error_message: "Model call timed out." })))
      .toBe("Model call timed out.");
  });

  it("treats a whitespace-only reason as no reason", () => {
    expect(nodeStoppedReason(node({ blocked_reason: "   ", error_message: "   " }))).toBeNull();
  });

  it("is null for a node that simply completed", () => {
    expect(nodeStoppedReason(node())).toBeNull();
  });
});

describe("describeNode", () => {
  it("derives the whole node once, with both durations formatted", () => {
    const detail = describeNode(node({
      job: "  Apply the change the architecture named.  ",
      lifecycle_stage: "IMPLEMENTATION",
      capability: "implementation",
      executor: "MODEL",
      depends_on: ["architecture"],
      max_attempts: 2,
      artifact_counts: { PATCH: 1 },
    }));

    expect(detail).toMatchObject({
      nodeKey: "implement",
      job: "Apply the change the architecture named.",
      stage: "IMPLEMENTATION",
      dependsOn: ["architecture"],
      maxAttempts: 2,
      elapsedMs: 90_000,
      elapsed: "1m 30s",
      queuedMs: 5_000,
      queued: "5.0s",
      artifactTotal: 1,
    });
  });

  it("reports an unrecognised stage as no stage rather than passing it through", () => {
    // The column is text and a row can predate a vocabulary. A stage the UI
    // cannot resolve must not reach a component that indexes by stage.
    expect(describeNode(node({ lifecycle_stage: "DISCOVER" })).stage).toBeNull();
  });

  it("keeps every recognised stage, including the three added in round 6", () => {
    expect(describeNode(node({ lifecycle_stage: "DISCOVERY" })).stage).toBe("DISCOVERY");
    expect(describeNode(node({ lifecycle_stage: "EVALUATION" })).stage).toBe("EVALUATION");
    expect(describeNode(node({ lifecycle_stage: "DECISION" })).stage).toBe("DECISION");
  });

  it("survives a node with nothing but a key and a state", () => {
    const bare = describeNode({ node_key: "goal", state: "PENDING" });
    expect(bare).toMatchObject({
      job: null,
      stage: null,
      dependsOn: [],
      maxAttempts: null,
      elapsed: null,
      queued: null,
      artifactTotal: 0,
      stoppedReason: null,
    });
  });

  it("drops a zero or negative artifact count instead of listing an empty kind", () => {
    const detail = describeNode(node({ artifact_counts: { REPORT: 0, PATCH: 2 } }));
    expect(detail.artifactCounts).toEqual({ PATCH: 2 });
    expect(detail.artifactTotal).toBe(2);
  });
});
