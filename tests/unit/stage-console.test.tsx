import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StageConsole } from "@/components/stage-console";

/**
 * The stage page, driven through the route it actually reads.
 *
 * Every case here is about what the page says when the database said something
 * short of "it worked": no runs at all, runs that never planned this stage, a
 * node with no provider, a stage with no artifacts. Those are the states this
 * product is in today, and a page that renders them as though work happened
 * would be the exact failure the reference forbids.
 */

function respond(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function runWith(nodes: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    graphRunId: "run-1",
    graphId: "graph-1",
    goal: "Add world-class backtesting to the trading platform.",
    topology: "DAG",
    riskLevel: "yellow",
    projectId: "project-1",
    state: "RUNNING",
    startedAt: "2026-08-23T10:00:00.000Z",
    completedAt: null,
    nodes,
    edges: [],
    artifactCounts: {},
    isLifecycle: true,
    iteration: 1,
    maxIterations: 3,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a stage page", () => {
  it("leads with the stage's number, name and purpose", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({ runs: [] })));
    render(<StageConsole stage="DISCOVER" />);

    expect(await screen.findByRole("heading", { name: "2 Discover", level: 1 }))
      .toBeInTheDocument();
    expect(
      screen.getByText(/Find what already exists — here, and in the wider world/),
    ).toBeInTheDocument();
  });

  it("says Not Started, and offers the one thing to do, when nothing has run", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({ runs: [] })));
    render(<StageConsole stage="BUILD" />);

    expect(await screen.findByText("Not Started")).toBeInTheDocument();
    expect(screen.getByText("No run has reached this stage")).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been launched yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start a run/i }))
      .toHaveAttribute("href", "/solutions/ai-factory");
  });

  it("distinguishes a stage nothing reached from a stage nothing planned", async () => {
    // Runs exist, but none of them staged its nodes. Saying "nothing has been
    // launched" there would be false, and it is the difference between "start
    // something" and "start something that uses the lifecycle".
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith([{ node_key: "authn", state: "COMPLETED", lifecycle_stage: null }])],
    })));
    render(<StageConsole stage="BUILD" />);

    expect(await screen.findByText(/none of them planned this stage/)).toBeInTheDocument();
  });

  it("reports the run's own state, progress and parallelism", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith([
        { node_key: "discover_internal", state: "COMPLETED", lifecycle_stage: "DISCOVER", depends_on: [] },
        { node_key: "discover_packages", state: "COMPLETED", lifecycle_stage: "DISCOVER", depends_on: [] },
        { node_key: "discover_shortlist", state: "PENDING", lifecycle_stage: "DISCOVER",
          depends_on: ["discover_internal", "discover_packages"] },
      ])],
    })));
    render(<StageConsole stage="DISCOVER" />);

    expect(await screen.findByText("2 of 3 nodes finished")).toBeInTheDocument();
    expect(screen.getByText("Up to 2 in parallel")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("says no agent is assigned rather than leaving the field blank", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith([{ node_key: "build_server", state: "PENDING", lifecycle_stage: "BUILD" }])],
    })));
    render(<StageConsole stage="BUILD" />);

    expect(
      await screen.findByText("None — no node in this stage has been dispatched to a provider."),
    ).toBeInTheDocument();
    expect(screen.getByText("No anchored observation recorded")).toBeInTheDocument();
  });

  it("opens a node onto its owner, dependencies, attempts, timing and artifacts", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith([{
        node_key: "build_server",
        job: "Build the server side the architecture named.",
        state: "COMPLETED",
        lifecycle_stage: "BUILD",
        executor: "MODEL",
        capability: "implementation",
        provider: "anthropic",
        model: "a-model",
        latency_ms: 4200,
        attempt: 1,
        attempts: 2,
        max_attempts: 2,
        artifact_count: 3,
        anchor_count: 0,
        depends_on: ["architect"],
        started_at: "2026-08-23T10:00:00.000Z",
        completed_at: "2026-08-23T10:00:04.200Z",
      }])],
    })));
    render(<StageConsole stage="BUILD" />);

    const tasks = within(await screen.findByRole("list", { name: "Tasks" }));
    await user.click(tasks.getByText("build_server"));

    expect(tasks.getByText("anthropic · a-model")).toBeInTheDocument();
    expect(tasks.getByText("2 recorded of 2 allowed")).toBeInTheDocument();
    expect(tasks.getByText("4.2s")).toBeInTheDocument();
    expect(tasks.getByText("3 recorded, none anchored")).toBeInTheDocument();
    // Its dependency, which sits in the previous stage.
    expect(tasks.getByText("architect")).toBeInTheDocument();
  });

  it("shows a node that has not been dispatched as not dispatched", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith([{ node_key: "test", state: "PENDING", lifecycle_stage: "TEST" }])],
    })));
    render(<StageConsole stage="TEST" />);

    const tasks = within(await screen.findByRole("list", { name: "Tasks" }));
    await user.click(tasks.getByText("test"));
    expect(
      screen.getByText("Not dispatched — no provider recorded for this node."),
    ).toBeInTheDocument();
  });

  it("repeats a failure in the worker's own words", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith([{
        node_key: "test",
        state: "FAILED",
        lifecycle_stage: "TEST",
        error_message: "vitest exited 1: 3 failed",
      }])],
    })));
    render(<StageConsole stage="TEST" />);

    expect(await screen.findByText("Failed")).toBeInTheDocument();

    // The worker's sentence appears twice on purpose: once in the issues list,
    // where a reader looking for problems finds it, and once inside the node
    // that produced it. Neither is a paraphrase.
    const issues = within(screen.getByRole("list", { name: "Issues" }));
    expect(issues.getByText(/vitest exited 1: 3 failed/)).toBeInTheDocument();

    const tasks = within(screen.getByRole("list", { name: "Tasks" }));
    await user.click(tasks.getByText("test"));
    expect(tasks.getByText("vitest exited 1: 3 failed")).toBeInTheDocument();
  });

  it("offers the decision where the gate is, and only while it is open", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/decide")) return respond({ note: "Recorded." });
      return respond({
        runs: [runWith([{
          node_key: "architect",
          state: "VERIFYING",
          lifecycle_stage: "ARCHITECT",
          gate_id: "gate-1",
          gate_kind: "HUMAN",
          gate_state: "OPEN",
          gate_anchor_count: 0,
        }])],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StageConsole stage="ARCHITECT" />);

    const tasks = within(await screen.findByRole("list", { name: "Tasks" }));
    await user.click(tasks.getByText("architect"));
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/graph-gates/gate-1/decide",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Recorded.");
  });

  it("passes the database's refusal through instead of a friendlier sentence", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/decide")) {
        return respond(
          { error: { message: "an automatic gate with no anchored evidence may not be approved" } },
          403,
        );
      }
      return respond({
        runs: [runWith([{
          node_key: "test",
          state: "VERIFYING",
          lifecycle_stage: "TEST",
          gate_id: "gate-2",
          gate_kind: "AUTOMATIC",
          gate_state: "OPEN",
          gate_anchor_count: 0,
        }])],
      });
    }));
    render(<StageConsole stage="TEST" />);

    const tasks = within(await screen.findByRole("list", { name: "Tasks" }));
    await user.click(tasks.getByText("test"));
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("status"))
      .toHaveTextContent("an automatic gate with no anchored evidence may not be approved");
  });

  it("links forward and back along the lifecycle", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith([
        { node_key: "decide", state: "COMPLETED", lifecycle_stage: "DECIDE" },
        { node_key: "architect", state: "RUNNING", lifecycle_stage: "ARCHITECT" },
      ])],
    })));
    render(<StageConsole stage="ARCHITECT" />);

    expect(await screen.findByRole("link", { name: "Open Decide" }))
      .toHaveAttribute("href", "/solutions/factory/decide");
    expect(screen.getByRole("link", { name: "Open Build" }))
      .toHaveAttribute("href", "/solutions/factory/build");
  });

  it("says the last stage closes the pass rather than linking to an eleventh", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith([{ node_key: "monitor", state: "RUNNING", lifecycle_stage: "MONITOR" }])],
    })));
    render(<StageConsole stage="MONITOR" />);

    expect(await screen.findByText(/It is the last stage of a pass/)).toBeInTheDocument();
  });

  it("does not claim an artifact exists when none was recorded", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith([{ node_key: "review", state: "COMPLETED", lifecycle_stage: "REVIEW" }])],
    })));
    render(<StageConsole stage="REVIEW" />);

    expect(await screen.findByText("No artifact has been recorded for this stage yet."))
      .toBeInTheDocument();
  });

  it("sends someone signed out to sign in, and an unfinished org to onboarding", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({}, 401)));
    const { unmount } = render(<StageConsole stage="BUILD" />);
    expect(await screen.findByRole("link", { name: "Sign in" }))
      .toHaveAttribute("href", "/auth/sign-in");
    unmount();

    vi.stubGlobal("fetch", vi.fn(() => respond({}, 409)));
    render(<StageConsole stage="BUILD" />);
    expect(await screen.findByRole("link", { name: "Continue setup" }))
      .toHaveAttribute("href", "/auth/onboarding");
  });

  it("reports a failed read as a failed read, not as an empty stage", async () => {
    // The specific thing this prevents: a 500 rendering as "Not Started",
    // which reads as "nothing has happened" rather than "we could not look".
    vi.stubGlobal("fetch", vi.fn(() => respond(
      { error: { message: "Graph runs could not be loaded." } },
      500,
    )));
    render(<StageConsole stage="BUILD" />);

    expect(await screen.findByText("This stage could not be read")).toBeInTheDocument();
    expect(screen.queryByText("Not Started")).not.toBeInTheDocument();
  });

  it("draws the execution graph as bands that run together", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith([
        { node_key: "build_server", state: "COMPLETED", lifecycle_stage: "BUILD", depends_on: [] },
        { node_key: "build_client", state: "COMPLETED", lifecycle_stage: "BUILD", depends_on: [] },
        { node_key: "build_integrate", state: "PENDING", lifecycle_stage: "BUILD",
          depends_on: ["build_server", "build_client"] },
      ])],
    })));
    render(<StageConsole stage="BUILD" />);

    const graph = within(await screen.findByRole("list", { name: "Execution graph" }));
    expect(graph.getByText("2 in parallel")).toBeInTheDocument();
    expect(graph.getByText("then")).toBeInTheDocument();
    // The bands are the stage's own dependencies, so the integrate node sits
    // below the two it waits on rather than beside them.
    expect(graph.getAllByRole("listitem")).toHaveLength(2);
  });

  it("lists every edge touching the stage with the reason it exists", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith(
        [{ node_key: "test", state: "PENDING", lifecycle_stage: "TEST", depends_on: ["review"] }],
        {
          edges: [
            { from_node_key: "review", to_node_key: "test", reason: "VERIFICATION",
              detail: "Tests run against a reviewed change.", is_feedback: false },
            { from_node_key: "test", to_node_key: "build_server", reason: "VERIFICATION",
              detail: "A failed test returns the work to the build.", is_feedback: true },
          ],
        },
      )],
    })));
    render(<StageConsole stage="TEST" />);

    expect(await screen.findByText("Tests run against a reviewed change.")).toBeInTheDocument();
    expect(screen.getByText("A failed test returns the work to the build.")).toBeInTheDocument();
    expect(screen.getByText("feedback")).toBeInTheDocument();
  });
});
