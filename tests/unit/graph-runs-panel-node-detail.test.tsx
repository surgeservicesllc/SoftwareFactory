import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphRunsPanel } from "@/components/graph-runs-panel";

/**
 * Opening a node, as a person meets it.
 *
 * Until now the table could say a node FAILED and nothing else. The projection
 * carries the rest, and this asserts the panel actually renders it — a panel
 * that derives the detail and forgets to show it passes every test the pure
 * derivation module has.
 *
 * The other half of what is pinned here is the *absences*: a duration that
 * cannot be measured, a retry count nobody writes, and an upstream failure
 * attributed to the wrong node would each render as an entirely plausible line.
 */

const baseNode = {
  node_key: "implement",
  executor: "MODEL",
  capability: "implementation",
  state: "COMPLETED",
  provider: "anthropic",
  model: "m",
  latency_ms: 800,
  error_message: null,
  lifecycle_stage: "IMPLEMENTATION",
  gate_kind: null,
  gate_id: null,
  gate_state: null,
};

function panelWith(nodes: readonly Record<string, unknown>[]) {
  return {
    runs: [
      {
        graphRunId: "80000000-0000-4000-8000-0000000000b1",
        graphId: "70000000-0000-4000-8000-0000000000b1",
        goal: "Ship the change the architecture named.",
        topology: "DIAMOND",
        riskLevel: "green",
        projectId: "40000000-0000-4000-8000-0000000000b1",
        state: "COMPLETED",
        hadPartialInput: false,
        startedAt: "2026-08-23T13:42:37.000Z",
        completedAt: "2026-08-23T13:48:30.000Z",
        nodes,
        artifactCounts: { RAW: 7 },
        verifications: [],
      },
    ],
  };
}

function stubFetch(payload: unknown) {
  vi.stubGlobal("fetch", () => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openNode(nodes: readonly Record<string, unknown>[], key = "implement") {
  stubFetch(panelWith(nodes));
  render(<GraphRunsPanel />);
  const toggle = await waitFor(() => screen.getByRole("button", { name: key }));
  await userEvent.click(toggle);
  return toggle;
}

describe("opening a node", () => {
  it("is closed until asked, so the table stays a table", async () => {
    stubFetch(panelWith([{ ...baseNode, job: "Apply the change." }]));
    render(<GraphRunsPanel />);

    const toggle = await waitFor(() => screen.getByRole("button", { name: "implement" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Apply the change.")).not.toBeInTheDocument();
  });

  it("shows what the node was asked to do", async () => {
    await openNode([{
      ...baseNode,
      job: "Apply the change the architecture named.",
      depends_on: ["architecture"],
    }]);

    expect(screen.getByText("Apply the change the architecture named.")).toBeInTheDocument();
    expect(screen.getByText("architecture")).toBeInTheDocument();
  });

  it("reports wall time from the node's clocks, not the executor's latency", async () => {
    // latency_ms is 800ms; the node occupied 90 seconds. Showing "0.8s" as the
    // node's duration would misattribute 89 seconds of the run.
    await openNode([{
      ...baseNode,
      node_started_at: "2026-08-23T10:00:05.000Z",
      node_completed_at: "2026-08-23T10:01:35.000Z",
    }]);

    expect(screen.getByText("Ran for")).toBeInTheDocument();
    expect(screen.getByText("1m 30s")).toBeInTheDocument();
  });

  it("omits the duration entirely for a node that never finished", async () => {
    await openNode([{
      ...baseNode,
      state: "RUNNING",
      node_started_at: "2026-08-23T10:00:05.000Z",
      node_completed_at: null,
    }]);

    expect(screen.queryByText("Ran for")).not.toBeInTheDocument();
  });

  it("never shows a retry count, because nothing writes one", async () => {
    // `max_attempts` is the configured ceiling and is real; a count is not.
    await openNode([{ ...baseNode, max_attempts: 3 }]);

    expect(screen.getByText("Attempts allowed")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/of 3/)).not.toBeInTheDocument();
  });

  it("blames the upstream block rather than this node's stale error", async () => {
    await openNode([{
      ...baseNode,
      state: "BLOCKED",
      blocked_reason: "Waiting on the architecture gate.",
      error_message: "Model call timed out.",
    }]);

    expect(screen.getByText("Waiting on the architecture gate.")).toBeInTheDocument();
  });

  it("says so plainly when the node produced nothing", async () => {
    await openNode([{ ...baseNode, artifact_counts: {} }]);
    expect(screen.getByText("No artifacts")).toBeInTheDocument();
  });

  it("counts artifacts by kind", async () => {
    await openNode([{ ...baseNode, artifact_counts: { SYNTHESIS: 2, RAW: 1 } }]);
    expect(screen.getByText("2 synthesis, 1 raw")).toBeInTheDocument();
  });

  it("renders a node from a deployment that predates the projection", async () => {
    // Every new key is optional on purpose: a cached bundle must render an old
    // response rather than blanking the run.
    await openNode([baseNode]);

    expect(screen.getByText("No artifacts")).toBeInTheDocument();
    expect(screen.queryByText("Ran for")).not.toBeInTheDocument();
    expect(screen.queryByText("Job")).not.toBeInTheDocument();
  });

  it("closes again when asked twice", async () => {
    const toggle = await openNode([{ ...baseNode, job: "Apply the change." }]);
    expect(screen.getByText("Apply the change.")).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByText("Apply the change.")).not.toBeInTheDocument();
  });
});
