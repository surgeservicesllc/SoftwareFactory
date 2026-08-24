import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LifecycleConsole } from "@/components/graph/lifecycle-console";

/**
 * The nodes behind a stage's figures.
 *
 * The stage page could say IMPLEMENTATION has four nodes and one failed, but
 * not which four or which one — a dashboard rather than something a person can
 * act on. These cases pin the list, and more importantly pin that it agrees
 * with the counts above it: both are read from the same `run.nodes` array, so
 * a filter that drifted would show one thing and count another.
 */

const node = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

function payload(nodes: readonly Record<string, unknown>[]) {
  return {
    runs: [
      {
        graphRunId: "80000000-0000-4000-8000-0000000000c1",
        graphId: "70000000-0000-4000-8000-0000000000c1",
        goal: "Ship the change the architecture named.",
        topology: "DIAMOND",
        riskLevel: "green",
        projectId: "40000000-0000-4000-8000-0000000000c1",
        state: "RUNNING",
        hadPartialInput: false,
        startedAt: "2026-08-23T13:42:37.000Z",
        completedAt: null,
        nodes,
        artifactCounts: {},
        verifications: [],
      },
    ],
  };
}

function stubFetch(body: unknown) {
  vi.stubGlobal("fetch", () => Promise.resolve({
    ok: true, status: 200, json: async () => body,
  } as Response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderStage(nodes: readonly Record<string, unknown>[]) {
  stubFetch(payload(nodes));
  render(<LifecycleConsole stage="IMPLEMENTATION" />);
  return waitFor(() => screen.getByRole("region", { name: /Runs that reached IMPLEMENTATION/i }));
}

describe("a stage's node list", () => {
  it("names the nodes behind the count, not just the count", async () => {
    const region = await renderStage([
      node({ node_key: "implement", job: "Apply the change." }),
      node({ node_key: "wire", job: "Wire it up." }),
    ]);

    expect(within(region).getByText("implement")).toBeInTheDocument();
    expect(within(region).getByText("wire")).toBeInTheDocument();
    expect(within(region).getByText("Apply the change.")).toBeInTheDocument();
  });

  it("lists only this stage's nodes, matching the count beside them", async () => {
    // The run has three nodes, one of them in another stage. The count says
    // "2 nodes" and the list must show exactly those two — a filter that
    // drifted from the summariser would show three under a count of two.
    const region = await renderStage([
      node({ node_key: "implement" }),
      node({ node_key: "wire" }),
      node({ node_key: "design", lifecycle_stage: "ARCHITECTURE" }),
    ]);

    expect(within(region).getByText(/2 of 2 nodes completed/)).toBeInTheDocument();
    expect(within(region).getByText("implement")).toBeInTheDocument();
    expect(within(region).getByText("wire")).toBeInTheDocument();
    expect(within(region).queryByText("design")).not.toBeInTheDocument();
  });

  it("shows why a failed node failed, where the reader is already looking", async () => {
    const region = await renderStage([
      node({ node_key: "implement", state: "FAILED", error_message: "Model call timed out." }),
    ]);

    expect(within(region).getByText("Model call timed out.")).toBeInTheDocument();
  });

  it("prefers an upstream block to this node's stale error", async () => {
    const region = await renderStage([
      node({
        node_key: "implement",
        state: "BLOCKED",
        blocked_reason: "Waiting on the architecture gate.",
        error_message: "Model call timed out.",
      }),
    ]);

    expect(within(region).getByText("Waiting on the architecture gate.")).toBeInTheDocument();
    expect(within(region).queryByText("Model call timed out.")).not.toBeInTheDocument();
  });

  it("shows wall time when both clocks exist and nothing when they do not", async () => {
    const region = await renderStage([
      node({
        node_key: "implement",
        node_started_at: "2026-08-23T10:00:05.000Z",
        node_completed_at: "2026-08-23T10:01:35.000Z",
      }),
      node({ node_key: "wire", state: "RUNNING", node_started_at: "2026-08-23T10:02:00.000Z" }),
    ]);

    expect(within(region).getByText("1m 30s")).toBeInTheDocument();
    // The running node contributes no duration rather than a growing one.
    expect(within(region).queryByText(/^0ms$/)).not.toBeInTheDocument();
  });

  it("says what a node waited for", async () => {
    const region = await renderStage([
      node({ node_key: "implement", depends_on: ["architecture", "decide"] }),
    ]);

    expect(within(region).getByText("Waited for architecture, decide")).toBeInTheDocument();
  });

  it("renders a node from a deployment that predates the projection", async () => {
    // Every detail key is optional; a cached bundle must still list the node.
    const region = await renderStage([node({ node_key: "implement" })]);

    expect(within(region).getByText("implement")).toBeInTheDocument();
    expect(within(region).queryByText(/Waited for/)).not.toBeInTheDocument();
  });

  it("still says plainly when no run has reached the stage", async () => {
    stubFetch(payload([node({ lifecycle_stage: "ARCHITECTURE" })]));
    render(<LifecycleConsole stage="DEPLOYMENT" />);

    const region = await waitFor(() =>
      screen.getByRole("region", { name: /Runs that reached DEPLOYMENT/i }));
    expect(within(region).getByText(/No recorded run has a node in this stage/)).toBeInTheDocument();
  });
});
