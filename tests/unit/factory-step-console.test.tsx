import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FactoryStepConsole,
  factoryRunNeedsLiveRefresh,
} from "@/components/graph/factory-step-console";
import type { RunView } from "@/components/graph/stage-content";
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
  identity: {
    graphId?: string;
    projectId?: string;
    templateKey?: string | null;
    templateVersion?: number | null;
    state?: string;
  } = {},
) {
  return {
    graphRunId: id,
    graphId: identity.graphId ?? "70000000-0000-4000-8000-0000000000f1",
    projectId: identity.projectId ?? "40000000-0000-4000-8000-000000000001",
    templateKey: identity.templateKey === undefined ? "full_lifecycle" : identity.templateKey,
    templateVersion: identity.templateVersion === undefined ? 2 : identity.templateVersion,
    goal,
    topology: "DIAMOND",
    state: identity.state ?? "PARTIAL",
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
  runsAfterGate?: readonly unknown[];
  runsAfterGateSequence?: readonly (readonly unknown[])[];
  artifacts?: readonly Record<string, unknown>[];
  artifactsError?: string;
  gateResult?: { readonly note?: string; readonly workerWoken?: boolean };
  launchResult?: Record<string, unknown>;
}) {
  gateCalls = [];
  fetchCalls = [];
  let gateRecorded = false;
  let postGateRunReads = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes("/api/graph-gates/")) {
      gateCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      gateRecorded = true;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => options.gateResult ?? { note: "Recorded.", workerWoken: true },
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
          workerWoken: false,
          note: "The graph is recorded; worker dispatch remains off.",
        },
      } as Response);
    }
    const sequencedRuns = gateRecorded && options.runsAfterGateSequence
      ? options.runsAfterGateSequence[
        Math.min(postGateRunReads++, options.runsAfterGateSequence.length - 1)
      ]
      : undefined;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        runs: sequencedRuns
          ?? (gateRecorded && options.runsAfterGate ? options.runsAfterGate : options.runs),
      }),
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
    const intervalSpy = vi.spyOn(window, "setInterval");
    stubFetch({
      runs: [oldRun],
      launchResult: {
        graphId: newGraphId,
        topology: "DAG",
        nodeCount: 14,
        edgeCount: 16,
        maxParallelism: 3,
        requiresOwnerApproval: false,
        workerWoken: false,
        note: "The graph is recorded. The executor is Not Connected, so no worker was woken.",
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

    expect(await screen.findByText("Graph recorded — executor Not Connected")).toBeInTheDocument();
    expect(screen.getByText("The graph is recorded. The executor is Not Connected, so no worker was woken."))
      .toBeInTheDocument();
    expect(screen.getByText(/Automatic polling is off because this request did not wake a worker/i))
      .toBeInTheDocument();
    expect(screen.getByText(newGraphId)).toBeInTheDocument();
    expect(screen.queryByText("The previous request.")).not.toBeInTheDocument();
    expect(intervalSpy.mock.calls.filter(([, delay]) => delay === 15_000)).toHaveLength(0);
    intervalSpy.mockRestore();
  });

  it("offers an open gate's decision on the step that holds it", async () => {
    const artifactId = "b0000000-0000-4000-8000-000000000009";
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
      artifacts: [{
        artifactId,
        nodeRunId: "c0000000-0000-4000-8000-000000000009",
        nodeKey: "architecture",
        kind: "RAW",
        payload: { summary: "The exact architecture." },
        createdAt: "2026-08-28T12:00:00.000Z",
      }],
    });
    const user = userEvent.setup();
    render(<FactoryStepConsole step={factoryStep("architect")!} />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(gateCalls).toHaveLength(1));
    expect(gateCalls[0].url).toContain("a0000000-0000-4000-8000-000000000009");
    expect(gateCalls[0].body).toEqual({ approved: true, evidenceArtifactId: artifactId });
    expect(await screen.findByText("Gate approved — waiting for continuation")).toBeInTheDocument();
  });

  it("keeps a recorded gate approval Not Connected when no worker was woken", async () => {
    const graphId = "70000000-0000-4000-8000-0000000000f1";
    const held = lifecycleRun("80000000-0000-4000-8000-0000000000f1", [
      node({
        node_key: "architecture",
        lifecycle_stage: "ARCHITECTURE",
        capability: "architecture",
        state: "VERIFYING",
        gate_kind: "HUMAN",
        gate_id: "a0000000-0000-4000-8000-000000000009",
        gate_state: "OPEN",
      }),
    ], "Held attempt.", { graphId });
    const approvedHeld = lifecycleRun(held.graphRunId, [
      node({
        node_key: "architecture",
        lifecycle_stage: "ARCHITECTURE",
        capability: "architecture",
        state: "COMPLETED",
        gate_kind: "HUMAN",
        gate_id: "a0000000-0000-4000-8000-000000000009",
        gate_state: "APPROVED",
      }),
    ], "Held attempt.", { graphId, state: "PARTIAL" });
    const artifactId = "b0000000-0000-4000-8000-000000000009";
    const note = "The gate is approved. The executor is Not Connected, so no worker was woken.";
    const intervalSpy = vi.spyOn(window, "setInterval");
    stubFetch({
      runs: [held],
      runsAfterGate: [approvedHeld],
      gateResult: { workerWoken: false, note },
      artifacts: [{
        artifactId,
        nodeRunId: "c0000000-0000-4000-8000-000000000009",
        nodeKey: "architecture",
        kind: "RAW",
        payload: { summary: "The exact architecture." },
        createdAt: "2026-08-28T12:00:00.000Z",
      }],
    });
    const user = userEvent.setup();
    render(
      <FactoryStepConsole
        step={factoryStep("architect")!}
        initialSelection={{
          graphId,
          graphRunId: held.graphRunId,
          projectId: held.projectId,
        }}
      />,
    );

    const approve = await screen.findByRole("button", { name: "Approve" });
    const intervalCallsBeforeGate = intervalSpy.mock.calls.filter(([, delay]) => delay === 15_000).length;
    await user.click(approve);

    expect(await screen.findByText("Gate approved — executor Not Connected")).toBeInTheDocument();
    expect(screen.getByText(note)).toBeInTheDocument();
    expect(screen.getByText(/Automatic continuation polling is off/i)).toBeInTheDocument();
    expect(screen.queryByText("Gate approved — waiting for continuation")).not.toBeInTheDocument();
    expect(intervalSpy.mock.calls.filter(([, delay]) => delay === 15_000))
      .toHaveLength(intervalCallsBeforeGate);
    intervalSpy.mockRestore();
  });

  it("follows only a newly recorded continuation attempt after approving a gate", async () => {
    const graphId = "70000000-0000-4000-8000-0000000000f1";
    const held = lifecycleRun("80000000-0000-4000-8000-0000000000f1", [
      node({
        node_key: "architecture",
        lifecycle_stage: "ARCHITECTURE",
        capability: "architecture",
        state: "VERIFYING",
        gate_kind: "HUMAN",
        gate_id: "a0000000-0000-4000-8000-000000000009",
        gate_state: "OPEN",
      }),
    ], "Held attempt.", { graphId });
    const continuation = lifecycleRun("80000000-0000-4000-8000-0000000000f2", [
      node({ node_key: "architecture", lifecycle_stage: "ARCHITECTURE" }),
    ], "Continued attempt.", { graphId, state: "RUNNING" });
    const artifactId = "b0000000-0000-4000-8000-000000000009";
    stubFetch({
      runs: [held],
      runsAfterGate: [continuation, held],
      artifacts: [{
        artifactId,
        nodeRunId: "c0000000-0000-4000-8000-000000000009",
        nodeKey: "architecture",
        kind: "RAW",
        payload: { summary: "The exact architecture." },
        createdAt: "2026-08-28T12:00:00.000Z",
      }],
    });
    const user = userEvent.setup();
    render(
      <FactoryStepConsole
        step={factoryStep("architect")!}
        initialSelection={{
          graphId,
          graphRunId: held.graphRunId,
          projectId: held.projectId,
        }}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByText("Continued attempt.")).toBeInTheDocument();
    expect(screen.queryByText("Held attempt.")).not.toBeInTheDocument();
    expect(fetchCalls.some((url) => url.includes(`${continuation.graphRunId}/artifacts`))).toBe(true);
  });

  it("keeps polling a terminal approved attempt until its continuation is recorded", async () => {
    const graphId = "70000000-0000-4000-8000-0000000000f1";
    const held = lifecycleRun("80000000-0000-4000-8000-0000000000f1", [
      node({
        node_key: "architecture",
        lifecycle_stage: "ARCHITECTURE",
        capability: "architecture",
        state: "VERIFYING",
        gate_kind: "HUMAN",
        gate_id: "a0000000-0000-4000-8000-000000000009",
        gate_state: "OPEN",
      }),
    ], "Held attempt.", { graphId });
    const approvedHeld = lifecycleRun(held.graphRunId, [
      node({
        node_key: "architecture",
        lifecycle_stage: "ARCHITECTURE",
        capability: "architecture",
        state: "COMPLETED",
        gate_kind: "HUMAN",
        gate_id: "a0000000-0000-4000-8000-000000000009",
        gate_state: "APPROVED",
      }),
    ], "Held attempt.", { graphId, state: "PARTIAL" });
    const continuation = lifecycleRun("80000000-0000-4000-8000-0000000000f2", [
      node({ node_key: "architecture", lifecycle_stage: "ARCHITECTURE" }),
    ], "Delayed continuation.", { graphId, state: "RUNNING" });
    const artifactId = "b0000000-0000-4000-8000-000000000009";
    stubFetch({
      runs: [held],
      runsAfterGateSequence: [[approvedHeld], [continuation, approvedHeld]],
      artifacts: [{
        artifactId,
        nodeRunId: "c0000000-0000-4000-8000-000000000009",
        nodeKey: "architecture",
        kind: "RAW",
        payload: { summary: "The exact architecture." },
        createdAt: "2026-08-28T12:00:00.000Z",
      }],
    });
    const intervalSpy = vi.spyOn(window, "setInterval");
    const user = userEvent.setup();
    render(
      <FactoryStepConsole
        step={factoryStep("architect")!}
        initialSelection={{
          graphId,
          graphRunId: held.graphRunId,
          projectId: held.projectId,
        }}
      />,
    );

    const approve = await screen.findByRole("button", { name: "Approve" });
    const factoryIntervalCallsBeforeGate = intervalSpy.mock.calls.filter(([, delay]) =>
      delay === 15_000
    ).length;
    await user.click(approve);
    expect(await screen.findByText("Gate approved — waiting for continuation")).toBeInTheDocument();
    expect(screen.getByText("Held attempt.")).toBeInTheDocument();

    await waitFor(() => {
      expect(intervalSpy.mock.calls.filter(([, delay]) => delay === 15_000).length)
        .toBeGreaterThan(factoryIntervalCallsBeforeGate);
    });
    const poll = intervalSpy.mock.calls.filter(([, delay]) => delay === 15_000).at(-1)?.[0];
    expect(typeof poll).toBe("function");
    const readsBeforePoll = fetchCalls.filter((url) => url.startsWith("/api/graphs/runs?")).length;
    await act(async () => {
      if (typeof poll === "function") poll();
    });
    await waitFor(() => {
      expect(fetchCalls.filter((url) => url.startsWith("/api/graphs/runs?")).length)
        .toBeGreaterThan(readsBeforePoll);
    });

    expect(await screen.findByText("Delayed continuation.")).toBeInTheDocument();
    expect(screen.queryByText("Gate approved — waiting for continuation")).not.toBeInTheDocument();
    intervalSpy.mockRestore();
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

  it("offers a manual refresh after a run is loaded", async () => {
    stubFetch({
      runs: [lifecycleRun(
        "80000000-0000-4000-8000-0000000000f1",
        [node({ state: "RUNNING" })],
        "Refresh this exact run.",
        { state: "RUNNING" },
      )],
    });
    const user = userEvent.setup();
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    const refresh = await screen.findByRole("button", { name: "Refresh run" });
    const readsBefore = fetchCalls.filter((url) => url.startsWith("/api/graphs/runs?")).length;
    await user.click(refresh);

    await waitFor(() => {
      expect(fetchCalls.filter((url) => url.startsWith("/api/graphs/runs?")).length)
        .toBeGreaterThan(readsBefore);
    });
  });

  it("polls only attempts whose stored work can still change", () => {
    const running = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f1",
      [node({ state: "RUNNING" })],
      "Still executing.",
      { state: "RUNNING" },
    );
    const held = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f2",
      [node({ state: "VERIFYING", gate_state: "OPEN" })],
      "Waiting for its gate.",
    );
    const complete = lifecycleRun(
      "80000000-0000-4000-8000-0000000000f3",
      [node()],
      "Finished.",
      { state: "COMPLETED" },
    );

    expect(factoryRunNeedsLiveRefresh(running as unknown as RunView)).toBe(true);
    expect(factoryRunNeedsLiveRefresh(held as unknown as RunView)).toBe(true);
    expect(factoryRunNeedsLiveRefresh(complete as unknown as RunView)).toBe(false);
  });

  it("states when bounded automatic refresh has stopped", async () => {
    stubFetch({
      runs: [lifecycleRun(
        "80000000-0000-4000-8000-0000000000f1",
        [node({ state: "RUNNING" })],
        "A long-running attempt.",
        { state: "RUNNING" },
      )],
    });
    const intervalSpy = vi.spyOn(window, "setInterval");
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    expect(await screen.findByText("A long-running attempt.")).toBeInTheDocument();
    const poll = intervalSpy.mock.calls.filter(([, delay]) => delay === 15_000).at(-1)?.[0];
    expect(typeof poll).toBe("function");

    await act(async () => {
      for (let tick = 0; tick < 40; tick += 1) {
        if (typeof poll === "function") poll();
      }
      await Promise.resolve();
    });

    expect(await screen.findByText("Automatic refresh paused")).toBeInTheDocument();
    expect(screen.getByText(/this page is no longer checking automatically/i)).toBeInTheDocument();
    intervalSpy.mockRestore();
  });

  it("identifies a legacy lifecycle and offers the current version", async () => {
    stubFetch({
      runs: [lifecycleRun(
        "80000000-0000-4000-8000-0000000000f1",
        [node()],
        "A historical request.",
        { templateKey: "full_lifecycle", templateVersion: 1 },
      )],
    });
    const user = userEvent.setup();
    render(<FactoryStepConsole step={factoryStep("requirement")!} />);

    expect(await screen.findByText("Historical lifecycle definition")).toBeInTheDocument();
    expect(screen.getByText(/full_lifecycle v1.*full_lifecycle v2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start the current Full Lifecycle" }));
    expect(await screen.findByRole("button", { name: /Launch Full Lifecycle/ })).toBeInTheDocument();
  });

  it("does not offer a release approval without the exact evidence artifact", async () => {
    stubFetch({
      runs: [lifecycleRun("80000000-0000-4000-8000-0000000000f1", [
        node({
          node_key: "test",
          lifecycle_stage: "TEST",
          capability: "qa",
          executor: "ANCHOR",
          state: "VERIFYING",
          gate_kind: "HUMAN",
          gate_id: "a0000000-0000-4000-8000-000000000010",
          gate_state: "OPEN",
          gate_anchor_count: 1,
        }),
      ], "Verify the exact release.")],
      artifacts: [],
    });
    render(<FactoryStepConsole step={factoryStep("test")!} />);

    const approval = await screen.findByRole("button", { name: "Accept merged pull request" });
    expect(approval).toBeDisabled();
    expect(screen.getByText(/Approval is unavailable until this stage records its exact evidence artifact/i))
      .toBeInTheDocument();
    expect(gateCalls).toEqual([]);
  });

  it("links TEST to the exact pull request and states that acceptance never merges", async () => {
    const pullRequestUrl = "https://github.com/surgeservicesllc/SoftwareFactory/pull/999";
    stubFetch({
      runs: [lifecycleRun("80000000-0000-4000-8000-0000000000f1", [
        node({
          node_key: "test",
          lifecycle_stage: "TEST",
          capability: "qa",
          executor: "ANCHOR",
          state: "VERIFYING",
          gate_kind: "HUMAN",
          gate_id: "a0000000-0000-4000-8000-000000000010",
          gate_state: "OPEN",
        }),
      ], "Verify the exact release.")],
      artifacts: [
        {
          artifactId: "b0000000-0000-4000-8000-000000000001",
          nodeRunId: "c0000000-0000-4000-8000-000000000001",
          nodeKey: "review",
          kind: "ANCHOR",
          payload: {
            observation: "phase1c_pull_request_review",
            pullRequestUrl,
            headSha: "1".repeat(40),
          },
          createdAt: "2026-08-28T12:00:00.000Z",
        },
        {
          artifactId: "b0000000-0000-4000-8000-000000000002",
          nodeRunId: "c0000000-0000-4000-8000-000000000002",
          nodeKey: "test",
          kind: "ANCHOR",
          payload: { observation: "ci_check_runs", sha: "1".repeat(40), total: 4, failing: [] },
          createdAt: "2026-08-28T12:01:00.000Z",
        },
        {
          artifactId: "b0000000-0000-4000-8000-000000000099",
          nodeRunId: "c0000000-0000-4000-8000-000000000099",
          nodeKey: "deploy",
          kind: "ANCHOR",
          payload: {
            observation: "github_production_deployment",
            sha: "2".repeat(40),
            deploymentId: 6137000001,
            environmentUrl: "https://softwarefactory-exact.vercel.app",
            state: "success",
          },
          createdAt: "2026-08-28T12:02:00.000Z",
        },
      ],
    });
    render(<FactoryStepConsole step={factoryStep("test")!} />);

    const link = await screen.findByRole("link", { name: "Open exact pull request" });
    expect(link).toHaveAttribute("href", pullRequestUrl);
    expect(screen.getAllByText("11111111").length).toBeGreaterThan(0);
    expect(screen.queryByText("22222222")).not.toBeInTheDocument();
    expect(screen.getAllByText(/never merges/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Accept merged pull request" })).toBeEnabled();
  });

  it("renders exact DEPLOY evidence and explains that acceptance never deploys", async () => {
    const deploymentUrl = "https://softwarefactory-exact.vercel.app";
    stubFetch({
      runs: [lifecycleRun("80000000-0000-4000-8000-0000000000f1", [
        node({
          node_key: "deploy",
          lifecycle_stage: "DEPLOYMENT",
          capability: "implementation",
          executor: "ANCHOR",
          state: "VERIFYING",
          gate_kind: "HUMAN",
          gate_id: "a0000000-0000-4000-8000-000000000011",
          gate_state: "OPEN",
        }),
      ], "Ship the exact release.")],
      artifacts: [{
        artifactId: "b0000000-0000-4000-8000-000000000003",
        nodeRunId: "c0000000-0000-4000-8000-000000000003",
        nodeKey: "deploy",
        kind: "ANCHOR",
        payload: {
          observation: "github_production_deployment",
          sha: "2".repeat(40),
          deploymentId: 6137000001,
          environmentUrl: deploymentUrl,
          state: "success",
        },
        createdAt: "2026-08-28T12:02:00.000Z",
      }],
    });
    render(<FactoryStepConsole step={factoryStep("deploy")!} />);

    expect(await screen.findByText("DEPLOY handoff: accept observed Production")).toBeInTheDocument();
    expect(screen.getByText("6137000001")).toBeInTheDocument();
    expect(screen.getAllByText(/never deploys/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open observed deployment" }))
      .toHaveAttribute("href", `${deploymentUrl}/`);
    expect(screen.getByRole("button", { name: "Accept production deployment" })).toBeEnabled();
  });
});
