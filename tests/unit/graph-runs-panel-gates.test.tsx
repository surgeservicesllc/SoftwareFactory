import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GraphRunsPanel } from "@/components/graph-runs-panel";

/**
 * The gate as a person meets it.
 *
 * The route and the database are tested elsewhere; what is asserted here is the
 * part someone touches — that a stage awaiting a decision says so, that the
 * decision reaches the right gate, and that a refusal arrives with the reason
 * rather than a friendlier substitute.
 */

function runWith(node: Record<string, unknown>) {
  return {
    runs: [
      {
        graphRunId: "80000000-0000-4000-8000-000000000001",
        graphId: "70000000-0000-4000-8000-000000000001",
        goal: "Ship the preferences screen.",
        topology: "SEQUENTIAL",
        riskLevel: "green",
        projectId: "40000000-0000-4000-8000-000000000001",
        state: "PARTIAL",
        hadPartialInput: true,
        startedAt: "2026-08-21T20:00:00.000Z",
        completedAt: "2026-08-21T20:05:00.000Z",
        nodes: [
          {
            node_key: "goal",
            executor: "MODEL",
            capability: "planning",
            state: "COMPLETED",
            provider: "anthropic",
            model: "m",
            latency_ms: 1200,
            error_message: null,
            lifecycle_stage: "REQUIREMENT",
            gate_kind: null,
            gate_id: null,
            gate_state: null,
          },
          node,
        ],
        artifactCounts: { RAW: 2 },
        verifications: [],
        isLifecycle: true,
        iteration: 1,
        maxIterations: 3,
      },
    ],
  };
}

const heldNode = {
  node_key: "architecture",
  executor: "MODEL",
  capability: "architecture",
  state: "VERIFYING",
  provider: "anthropic",
  model: "m",
  latency_ms: 900,
  error_message: null,
  lifecycle_stage: "ARCHITECT",
  gate_kind: "HUMAN",
  gate_id: "a0000000-0000-4000-8000-000000000009",
  gate_state: "OPEN",
  gate_anchor_count: 0,
  gate_reason: null,
};

let calls: { url: string; body: unknown }[] = [];

function stubFetch(decide: () => { ok: boolean; payload: unknown }) {
  calls = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/graph-gates/")) {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const result = decide();
      return Promise.resolve({
        ok: result.ok,
        status: result.ok ? 200 : 403,
        json: async () => result.payload,
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => runWith(heldNode),
    } as Response);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  stubFetch(() => ({ ok: true, payload: { note: "The gate is approved. The worker picks the graph up again on its next claim." } }));
});

describe("a lifecycle gate in the runs panel", () => {
  it("says a stage is awaiting a decision, which its state alone does not", async () => {
    render(<GraphRunsPanel />);

    // VERIFYING is a state; "awaiting a decision" is what it means for a person.
    expect(await screen.findByText(/awaiting a decision/i)).toBeInTheDocument();
    expect(screen.getByText("ARCHITECT")).toBeInTheDocument();
  });

  it("sends the decision to the gate the node names", async () => {
    const user = userEvent.setup();
    render(<GraphRunsPanel />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toContain("a0000000-0000-4000-8000-000000000009");
    expect(calls[0].body).toEqual({ approved: true });
  });

  it("reports the approval without implying the work resumed", async () => {
    const user = userEvent.setup();
    render(<GraphRunsPanel />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByText(/next claim/i)).toBeInTheDocument();
  });

  it("shows the database's own refusal rather than a friendlier one", async () => {
    stubFetch(() => ({
      ok: false,
      payload: { error: { message: "owner or admin role is required to decide a human gate" } },
    }));
    const user = userEvent.setup();
    render(<GraphRunsPanel />);

    await user.click(await screen.findByRole("button", { name: "Reject" }));

    expect(
      await screen.findByText(/owner or admin role is required/i),
    ).toBeInTheDocument();
  });

  it("offers no decision on a node whose gate is already decided", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => runWith({ ...heldNode, state: "COMPLETED", gate_state: "APPROVED" }),
      } as Response),
    );
    render(<GraphRunsPanel />);

    await screen.findByText("ARCHITECT");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByText(/awaiting a decision/i)).toBeNull();
  });

  it("renders a run from a deployment that predates the lifecycle", async () => {
    // The response is JSON off the network: a missing key must not blank the
    // view, which is the same rule `verifications` already follows.
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          runWith({
            node_key: "architecture",
            executor: "MODEL",
            capability: "architecture",
            state: "COMPLETED",
            provider: null,
            model: null,
            latency_ms: null,
            error_message: null,
          }),
      } as Response),
    );
    render(<GraphRunsPanel />);

    const row = (await screen.findByText("architecture")).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    // Column order is node, stage, state: an absent stage renders as an em dash
    // rather than "undefined", and the row survives to show its state.
    expect(cells[1]).toHaveTextContent("—");
    expect(cells[2]).toHaveTextContent("COMPLETED");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByText(/awaiting a decision/i)).toBeNull();
  });
});
