import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphRunsPanel } from "@/components/graph-runs-panel";

/**
 * The lifecycle summary as a person meets it.
 *
 * Every node carries a stage now, and until this the only place that showed was
 * one column of a node table — which says what ran, not how far through the
 * lifecycle the run got. The grouping is asserted here rather than in the pure
 * summariser alone, because a panel that computes it and forgets to render it
 * passes every unit test the summariser has.
 */
function panelWith(nodes: readonly Record<string, unknown>[]) {
  return {
    runs: [
      {
        graphRunId: "80000000-0000-4000-8000-0000000000a1",
        graphId: "70000000-0000-4000-8000-0000000000a1",
        goal: "Check the things that break on the first real day.",
        topology: "DIAMOND",
        riskLevel: "green",
        projectId: "40000000-0000-4000-8000-0000000000a1",
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

const node = (key: string, stage: string | null, state: string) => ({
  node_key: key,
  executor: "MODEL",
  capability: "review",
  state,
  provider: "anthropic",
  model: "m",
  latency_ms: 1000,
  error_message: null,
  lifecycle_stage: stage,
  gate_kind: null,
  gate_id: null,
  gate_state: null,
});

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

describe("the run's lifecycle summary", () => {
  it("groups a run's nodes by the stage they sit in", async () => {
    stubFetch(panelWith([
      node("config", "REVIEW", "COMPLETED"),
      node("migrations", "REVIEW", "COMPLETED"),
      node("errors", "REVIEW", "FAILED"),
      node("coverage", "TEST", "COMPLETED"),
    ]));

    render(<GraphRunsPanel />);

    const summary = await waitFor(() => {
      const heading = screen.getByText("Lifecycle");
      return heading.parentElement as HTMLElement;
    });

    const review = within(summary).getByText("REVIEW").closest("li") as HTMLElement;
    expect(within(review).getByText("2/3")).toBeInTheDocument();
    expect(within(review).getByText("1 failed")).toBeInTheDocument();

    const test = within(summary).getByText("TEST").closest("li") as HTMLElement;
    expect(within(test).getByText("1/1")).toBeInTheDocument();
  });

  it("says how many nodes carry no stage rather than dropping them", async () => {
    // Without this the counts would not add up to the table beneath them, which
    // is worse than saying the run has rows this cannot place.
    stubFetch(panelWith([
      node("config", "REVIEW", "COMPLETED"),
      node("legacy", null, "COMPLETED"),
    ]));

    render(<GraphRunsPanel />);

    expect(await screen.findByText("1 with no stage")).toBeInTheDocument();
  });

  it("shows no summary at all when nothing in the run has a stage", async () => {
    /*
     * A run recorded before the stage rule, on a deployment that has not been
     * backfilled. An empty "Lifecycle" frame would imply the run had no stages
     * rather than that this cannot say.
     */
    stubFetch(panelWith([node("legacy", null, "COMPLETED")]));

    render(<GraphRunsPanel />);

    // The run itself renders; only the summary is withheld.
    await screen.findByText(/first real day/i);
    expect(screen.queryByText("Lifecycle")).not.toBeInTheDocument();
  });
});
