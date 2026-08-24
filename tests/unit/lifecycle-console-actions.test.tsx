import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LifecycleConsole } from "@/components/graph/lifecycle-console";

/**
 * The lifecycle page as a place to act, not just to read.
 *
 * The stage index used to be eleven static cards — accurate, and useless to a
 * person who wanted the work to move. These cases pin the two actions the page
 * now offers: launching the full lifecycle from the page itself, and deciding
 * an open gate on the card of the stage that holds it, through the same route
 * the runs panel uses.
 */

const node = (overrides: Record<string, unknown> = {}) => ({
  node_key: "architecture",
  executor: "MODEL",
  capability: "architecture",
  state: "VERIFYING",
  provider: "anthropic",
  model: "m",
  latency_ms: 900,
  error_message: null,
  lifecycle_stage: "ARCHITECTURE",
  gate_kind: null,
  gate_id: null,
  gate_state: null,
  ...overrides,
});

const heldNode = node({
  gate_kind: "HUMAN",
  gate_id: "a0000000-0000-4000-8000-000000000009",
  gate_state: "OPEN",
  gate_anchor_count: 0,
});

function run(id: string, nodes: readonly Record<string, unknown>[], goal = "Ship the change.") {
  return {
    graphRunId: id,
    graphId: "70000000-0000-4000-8000-0000000000c1",
    goal,
    topology: "DIAMOND",
    state: "PARTIAL",
    hadPartialInput: true,
    startedAt: "2026-08-24T13:42:37.000Z",
    completedAt: "2026-08-24T13:50:00.000Z",
    nodes,
    artifactCounts: {},
    verifications: [],
    isLifecycle: true,
  };
}

let gateCalls: { url: string; body: unknown }[] = [];
let runsReads = 0;

function stubFetch(runs: readonly unknown[]) {
  gateCalls = [];
  runsReads = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/graph-gates/")) {
      gateCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ note: "The gate is approved. The worker picks the graph up again on its next claim." }),
      } as Response);
    }
    if (url.includes("/api/projects")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ projects: [{ id: "40000000-0000-4000-8000-000000000001", name: "Demo" }] }),
      } as Response);
    }
    runsReads += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ runs }),
    } as Response);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the lifecycle index as an actionable page", () => {
  it("offers the full-lifecycle launch on the page itself, even before any run", async () => {
    stubFetch([]);
    render(<LifecycleConsole />);

    expect(
      await screen.findByRole("button", { name: /Launch Full Lifecycle/ }),
    ).toBeInTheDocument();
    // The empty state still stands beside it: the control is how it fills.
    expect(screen.getByText("No run has been recorded yet")).toBeInTheDocument();
  });

  it("offers an open gate's decision on the stage card that holds it", async () => {
    stubFetch([run("80000000-0000-4000-8000-0000000000c1", [heldNode])]);
    render(<LifecycleConsole />);

    const title = await screen.findByRole("link", { name: "ARCHITECTURE" });
    const card = title.closest("li") as HTMLElement;
    expect(within(card).getByText(/Awaiting a decision/)).toBeInTheDocument();
    expect(within(card).getByText("Ship the change.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("sends the decision to the gate the node names, then re-reads the runs", async () => {
    stubFetch([run("80000000-0000-4000-8000-0000000000c1", [heldNode])]);
    const user = userEvent.setup();
    render(<LifecycleConsole />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(gateCalls).toHaveLength(1));
    expect(gateCalls[0].url).toContain("a0000000-0000-4000-8000-000000000009");
    expect(gateCalls[0].body).toEqual({ approved: true });
    // The card's figures come from the runs read, so a decision re-reads them
    // rather than leaving the page describing a gate that no longer holds.
    await waitFor(() => expect(runsReads).toBeGreaterThan(1));
  });

  it("offers no decision when the stage's gates are decided or absent", async () => {
    stubFetch([
      run("80000000-0000-4000-8000-0000000000c1", [
        node({ state: "COMPLETED", gate_kind: "HUMAN", gate_id: heldNode.gate_id, gate_state: "APPROVED" }),
        node({ node_key: "implement", lifecycle_stage: "IMPLEMENTATION", state: "COMPLETED" }),
      ]),
    ]);
    render(<LifecycleConsole />);

    await screen.findByRole("link", { name: "ARCHITECTURE" });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByText(/Awaiting a decision/)).toBeNull();
  });

  it("still offers an older run's open gate when the newest run has none", async () => {
    // The resume case: a run closes PARTIAL at its gate, and the decision is
    // what lets the next claim proceed. Runs arrive newest-first, so the open
    // gate lives on the second row here — the card must still find it.
    stubFetch([
      run("80000000-0000-4000-8000-0000000000c2", [
        node({ node_key: "goal", lifecycle_stage: "GOAL", state: "COMPLETED" }),
      ], "A newer analysis run."),
      run("80000000-0000-4000-8000-0000000000c1", [heldNode], "The halted lifecycle."),
    ]);
    render(<LifecycleConsole />);

    const title = await screen.findByRole("link", { name: "ARCHITECTURE" });
    const card = title.closest("li") as HTMLElement;
    expect(within(card).getByText("The halted lifecycle.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("offers the decision on the stage page's node row too", async () => {
    stubFetch([run("80000000-0000-4000-8000-0000000000c1", [heldNode])]);
    const user = userEvent.setup();
    render(<LifecycleConsole stage="ARCHITECTURE" />);

    const region = await waitFor(() =>
      screen.getByRole("region", { name: /Runs that reached ARCHITECTURE/i }));
    expect(within(region).getByText(/awaiting a decision/)).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(gateCalls).toHaveLength(1));
    expect(gateCalls[0].body).toEqual({ approved: false });
  });
});
