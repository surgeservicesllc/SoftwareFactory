import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FactoryStepConsole } from "@/components/graph/factory-step-console";
import { factoryStep } from "@/lib/sdlc/factory-steps";

/**
 * A factory step page over one exact lifecycle selection.
 *
 * The pages under "02. AI Factory" walk the owner's ten-step process over
 * one full-lifecycle run. These cases pin the scope and the honesty:
 * exact graph/run/project selection never falls through to another run, the
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

function lifecycleRun(
  id: string,
  nodes: readonly Record<string, unknown>[],
  goal: string,
  identity: { graphId?: string; projectId?: string } = {},
) {
  return {
    graphRunId: id,
    graphId: identity.graphId ?? "70000000-0000-4000-8000-0000000000f1",
    projectId: identity.projectId ?? "40000000-0000-4000-8000-000000000001",
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
let fetchCalls: string[] = [];

function stubFetch(options: {
  runs: readonly unknown[];
  artifacts?: readonly Record<string, unknown>[];
  artifactsError?: string;
  launchResult?: Record<string, unknown>;
}) {
  gateCalls = [];
  fetchCalls = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes("/api/graph-gates/")) {
      gateCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({ note: "Recorded." }),
      } as Response);
    }
    if (url.includes("/artifacts")) {
      if (options.artifactsError) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({ error: { message: options.artifactsError } }),
        } as Response);
      }
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
    if (url === "/api/graphs" && init?.method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => options.launchResult ?? {
          graphId: "70000000-0000-4000-8000-0000000000f9",
          topology: "DAG",
          nodeCount: 14,
          edgeCount: 16,
          maxParallelism: 3,
          requiresOwnerApproval: false,
          note: "The graph is recorded; worker dispatch remains off.",
        },
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
    const strip = screen.getByRole("list", { name: /ten factory steps/i });
    expect(within(strip).getAllByRole("link")).toHaveLength(10);
    expect(within(strip).getByRole("link", { name: /1\. Requirement/ }))
      .toHaveAttribute("aria-current", "page");
  });

  it("does not complete REQUIREMENT when one of its mapped stages is absent", async () => {
    stubFetch({
      runs: [lifecycleRun(
        "80000000-0000-4000-8000-0000000000f1",
        [node()],
        "Only the goal was recorded.",
      )],
    });
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    const strip = await screen.findByRole("list", { name: /ten factory steps/i });
    expect(within(strip).getByRole("link", { name: /1\. Requirement — Not planned/i }))
      .toBeInTheDocument();
    expect(within(strip).queryByRole("link", { name: /1\. Requirement — Complete/i }))
      .not.toBeInTheDocument();
  });

  it("points the Runs crumb at Runs", async () => {
    // It pointed at /solutions/pipelines: a crumb named Runs that went
    // somewhere else, to a page the run it came from was not on either.
    stubFetch({
      runs: [lifecycleRun("80000000-0000-4000-8000-0000000000f1", [node()], "The run under way.")],
    });
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    // Waited for the run to land first: the loading shell renders a
    // breadcrumb too, and it has no run crumb to assert on.
    await screen.findByRole("button", { name: /new request/i });
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Runs" }))
      .toHaveAttribute("href", "/solutions/runs");
    // The run crumb still opens the run itself, named as the run list names it.
    expect(within(crumbs).getByRole("link", { name: "80000000" }))
      .toHaveAttribute("href", "/solutions/lifecycle/run/80000000-0000-4000-8000-0000000000f1/goal");
  });

  it("offers New Request on a step that already has a run, and launches from it", async () => {
    /*
     * The launcher used to appear only when no lifecycle run existed, so once
     * one did these pages had no way to start another. The button discloses
     * the same control rather than a second way to start work.
     */
    stubFetch({
      runs: [lifecycleRun("80000000-0000-4000-8000-0000000000f1", [node()], "The run under way.")],
    });
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    const button = await screen.findByRole("button", { name: /new request/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    // Closed, the launcher is genuinely absent rather than merely hidden.
    expect(screen.queryByRole("button", { name: /^launch/i })).not.toBeInTheDocument();

    await userEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^launch/i })).toBeInTheDocument();
    });
    // It says what a request is, rather than implying a prompt it cannot take.
    expect(screen.getByText(/runs the whole ten-step lifecycle once/i)).toBeInTheDocument();

    // Closing puts it away again.
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^launch/i })).not.toBeInTheDocument();
  });

  it("uses the only lifecycle run and ignores a newer analysis run", async () => {
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

  it("requires an exact choice when multiple projects have lifecycle runs", async () => {
    const otherRun = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f2",
      [node()],
      "Newest work for another project.",
      {
        graphId: "70000000-0000-4000-8000-0000000000f2",
        projectId: "40000000-0000-4000-8000-000000000002",
      },
    );
    const selectedRun = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f1",
      [node()],
      "The exact project request.",
    );
    stubFetch({ runs: [otherRun, selectedRun] });
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    expect(await screen.findByText("Choose the lifecycle run to inspect")).toBeInTheDocument();
    expect(screen.queryByText("Newest work for another project.")).not.toBeInTheDocument();
    expect(screen.queryByText("The exact project request.")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Lifecycle run"), selectedRun.graphRunId);

    expect(await screen.findByText("The exact project request.")).toBeInTheDocument();
    expect(screen.queryByText("Newest work for another project.")).not.toBeInTheDocument();
    expect(fetchCalls.some((url) => url.includes(`${selectedRun.graphRunId}/artifacts`))).toBe(true);
    expect(fetchCalls.some((url) => url.includes(`${otherRun.graphRunId}/artifacts`))).toBe(false);

    const strip = screen.getByRole("list", { name: /ten factory steps/i });
    expect(within(strip).getByRole("link", { name: /2\. Discover/ })).toHaveAttribute(
      "href",
      `/solutions/factory/discover?graphId=${selectedRun.graphId}`
        + `&graphRunId=${selectedRun.graphRunId}&projectId=${selectedRun.projectId}`,
    );
  });

  it("binds an explicit graph and project instead of the newer organization-wide run", async () => {
    const newerOther = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f2",
      [node()],
      "Newer but unrelated.",
      {
        graphId: "70000000-0000-4000-8000-0000000000f2",
        projectId: "40000000-0000-4000-8000-000000000002",
      },
    );
    const selected = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f1",
      [node()],
      "Bound by graph and project.",
    );
    stubFetch({ runs: [newerOther, selected] });
    render(
      <FactoryStepConsole
        step={factoryStep("requirement")!}
        initialSelection={{ graphId: selected.graphId, projectId: selected.projectId }}
      />,
    );

    expect(await screen.findByText("Bound by graph and project.")).toBeInTheDocument();
    expect(screen.queryByText("Newer but unrelated.")).not.toBeInTheDocument();
    const strip = screen.getByRole("list", { name: /ten factory steps/i });
    expect(within(strip).getByRole("link", { name: /2\. Discover/ })).toHaveAttribute(
      "href",
      `/solutions/factory/discover?graphId=${selected.graphId}`
        + `&graphRunId=${selected.graphRunId}&projectId=${selected.projectId}`,
    );
  });

  it("requires an exact run choice when one graph has more than one run", async () => {
    const older = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f1",
      [node()],
      "Older attempt of the selected graph.",
    );
    const newer = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f2",
      [node()],
      "Newer attempt of the selected graph.",
    );
    stubFetch({ runs: [newer, older] });
    render(
      <FactoryStepConsole
        step={factoryStep("requirement")!}
        initialSelection={{ graphId: newer.graphId, projectId: newer.projectId }}
      />,
    );

    expect(await screen.findByText("Choose the lifecycle run to inspect")).toBeInTheDocument();
    expect(screen.queryByText("Older attempt of the selected graph.")).not.toBeInTheDocument();
    expect(screen.queryByText("Newer attempt of the selected graph.")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Lifecycle run"), older.graphRunId);

    expect(await screen.findByText("Older attempt of the selected graph.")).toBeInTheDocument();
    expect(screen.queryByText("Newer attempt of the selected graph.")).not.toBeInTheDocument();
  });

  it("fails a mismatched run/graph/project selection closed", async () => {
    const run = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f1",
      [node()],
      "Must not leak into the mismatch.",
    );
    stubFetch({ runs: [run] });
    render(
      <FactoryStepConsole
        step={factoryStep("requirement")!}
        initialSelection={{
          graphRunId: run.graphRunId,
          graphId: "70000000-0000-4000-8000-000000000099",
          projectId: run.projectId,
        }}
      />,
    );

    expect(await screen.findByText("Selected lifecycle run is unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Must not leak into the mismatch.")).not.toBeInTheDocument();
    expect(fetchCalls.some((url) => url.includes("/artifacts"))).toBe(false);
  });

  it("binds a newly recorded graph before it has a run instead of retaining the old run", async () => {
    const oldRun = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f1",
      [node()],
      "The previous request.",
    );
    const newGraphId = "70000000-0000-4000-8000-0000000000f9";
    stubFetch({
      runs: [oldRun],
      launchResult: {
        graphId: newGraphId,
        topology: "DAG",
        nodeCount: 14,
        edgeCount: 16,
        maxParallelism: 3,
        requiresOwnerApproval: false,
        note: "The graph is recorded; worker dispatch remains off.",
      },
    });
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    await userEvent.click(await screen.findByRole("button", { name: /new request/i }));
    await userEvent.selectOptions(
      await screen.findByLabelText("Project"),
      "40000000-0000-4000-8000-000000000001",
    );
    await userEvent.type(screen.getByLabelText("Goal"), "The newly selected request.");
    await userEvent.click(screen.getByRole("button", { name: /launch full lifecycle/i }));

    expect(await screen.findByText("Selected graph has no visible run yet")).toBeInTheDocument();
    expect(screen.getByText(newGraphId)).toBeInTheDocument();
    expect(screen.queryByText("The previous request.")).not.toBeInTheDocument();
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

  it("derives the Gate tile from gates stored on this run's nodes", async () => {
    stubFetch({
      runs: [lifecycleRun("80000000-0000-4000-8000-0000000000f1", [
        node({
          node_key: "decide",
          lifecycle_stage: "DECISION",
          capability: "decision",
          gate_kind: null,
        }),
      ], "Choose the implementation path.")],
    });
    render(<FactoryStepConsole step={factoryStep("decide")!} />);

    const gateLabel = await screen.findByText("Gate");
    expect(gateLabel.nextElementSibling).toHaveTextContent("None");
    expect(gateLabel.nextElementSibling).not.toHaveTextContent("Automatic");
  });

  it("surfaces an artifact read failure instead of presenting an empty result", async () => {
    stubFetch({
      runs: [lifecycleRun(
        "80000000-0000-4000-8000-0000000000f1",
        [node()],
        "Read the recorded evidence.",
      )],
      artifactsError: "Artifact evidence is temporarily unavailable.",
    });
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Run artifacts could not be read");
    expect(alert).toHaveTextContent("Artifact evidence is temporarily unavailable.");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
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
