import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FactoryStepConsole } from "@/components/graph/factory-step-console";
import { factoryStep } from "@/lib/sdlc/factory-steps";

/**
 * A factory step page over the newest lifecycle run.
 *
 * The pages under "02. AI Factory" walk the owner's ten-step process over
 * the newest full-lifecycle run. These cases pin the scope and the honesty:
 * the newest *lifecycle* run is chosen (not a newer analysis run), the
 * REQUIREMENT step covers both of its stages, an open gate is decidable on
 * the step that holds it, and an account with no lifecycle run is offered
 * the launch rather than an empty imitation of one.
 */

const node = (overrides: Record<string, unknown> = {}) => ({
  node_key: "goal",
  executor: "MODEL",
  capability: "planning",
  state: "COMPLETED",
  provider: "anthropic",
  model: "m",
  latency_ms: 500,
  error_message: null,
  lifecycle_stage: "GOAL",
  gate_kind: null,
  gate_id: null,
  gate_state: null,
  ...overrides,
});

function lifecycleRun(id: string, nodes: readonly Record<string, unknown>[], goal: string) {
  return {
    graphRunId: id,
    graphId: "70000000-0000-4000-8000-0000000000f1",
    goal,
    topology: "DIAMOND",
    state: "PARTIAL",
    hadPartialInput: true,
    startedAt: "2026-08-24T12:00:00.000Z",
    completedAt: null,
    nodes,
    artifactCounts: {},
    verifications: [],
    isLifecycle: true,
  };
}

let gateCalls: { url: string; body: unknown }[] = [];

function stubFetch(options: {
  runs: readonly unknown[];
  artifacts?: readonly Record<string, unknown>[];
}) {
  gateCalls = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/graph-gates/")) {
      gateCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({ note: "Recorded." }),
      } as Response);
    }
    if (url.includes("/artifacts")) {
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({ artifacts: options.artifacts ?? [] }),
      } as Response);
    }
    if (url.includes("/api/projects")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ projects: [{ id: "40000000-0000-4000-8000-000000000001", name: "Demo" }] }),
      } as Response);
    }
    return Promise.resolve({
      ok: true, status: 200, json: async () => ({ runs: options.runs }),
    } as Response);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a factory step page", () => {
  it("covers both REQUIREMENT stages and names the request verbatim", async () => {
    stubFetch({
      runs: [lifecycleRun("80000000-0000-4000-8000-0000000000f1", [
        node(),
        node({ node_key: "requirements", lifecycle_stage: "PRD", job: "Write the PRD." }),
      ], "Ship the preferences screen.")],
    });
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    expect(await screen.findByText("Ship the preferences screen.")).toBeInTheDocument();
    // Both stages of the step render their own sections.
    expect(screen.getByRole("region", { name: "GOAL in this run" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "PRD in this run" })).toBeInTheDocument();
    // The ten-step strip links every step.
    const strip = screen.getByRole("navigation", { name: /ten factory steps/i });
    expect(within(strip).getAllByRole("link")).toHaveLength(10);
    expect(within(strip).getByRole("link", { name: /1\. Requirement/ }))
      .toHaveAttribute("aria-current", "page");
  });

  it("chooses the newest lifecycle run, not a newer analysis run", async () => {
    stubFetch({
      runs: [
        { ...lifecycleRun("80000000-0000-4000-8000-0000000000f2", [node()], "A newer analysis."), isLifecycle: false },
        lifecycleRun("80000000-0000-4000-8000-0000000000f1", [node()], "The lifecycle under way."),
      ],
    });
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    expect(await screen.findByText("The lifecycle under way.")).toBeInTheDocument();
    expect(screen.queryByText("A newer analysis.")).not.toBeInTheDocument();
  });

  it("offers an open gate's decision on the step that holds it", async () => {
    stubFetch({
      runs: [lifecycleRun("80000000-0000-4000-8000-0000000000f1", [
        node({
          node_key: "architecture",
          lifecycle_stage: "ARCHITECTURE",
          capability: "architecture",
          state: "VERIFYING",
          gate_kind: "HUMAN",
          gate_id: "a0000000-0000-4000-8000-000000000009",
          gate_state: "OPEN",
          gate_anchor_count: 0,
        }),
      ], "Design under decision.")],
    });
    const user = userEvent.setup();
    render(<FactoryStepConsole step={factoryStep("architect")!} />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(gateCalls).toHaveLength(1));
    expect(gateCalls[0].url).toContain("a0000000-0000-4000-8000-000000000009");
    expect(gateCalls[0].body).toEqual({ approved: true });
  });

  it("offers the launch when no lifecycle run exists, instead of an empty imitation", async () => {
    stubFetch({ runs: [] });
    render(<FactoryStepConsole step={factoryStep("build")!} />);

    expect(await screen.findByText("No lifecycle has run yet")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Launch Full Lifecycle/ }),
    ).toBeInTheDocument();
  });

  it("says a stage this run never planned has no nodes, without inventing rows", async () => {
    stubFetch({
      runs: [lifecycleRun("80000000-0000-4000-8000-0000000000f1", [node()], "Only the goal so far.")],
    });
    render(<FactoryStepConsole step={factoryStep("deploy")!} />);

    expect(await screen.findByText("This run planned no node in this stage.")).toBeInTheDocument();
  });
});
