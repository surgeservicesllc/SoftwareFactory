import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BuildWorkspace } from "@/components/build-workspace";

/**
 * The conversational front door's honesty rules: the transcript's factory
 * entries are recorded state, progress is counted from real node states, a
 * refusal is shown in the server's words, and nothing about a run renders
 * before the live feed actually reports one.
 */

const PROJECTS = {
  projects: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Storefront", connectionStatus: "connected" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Blog", connectionStatus: "connected" },
  ],
};

const LAUNCH = {
  graphId: "33333333-3333-4333-8333-333333333333",
  topology: "dag",
  nodeCount: 12,
  edgeCount: 14,
  maxParallelism: 3,
  requiresOwnerApproval: false,
  workerWoken: true,
  note: "Worker woken through the project's GitHub binding.",
};

function node(
  key: string,
  stage: string,
  state: string,
  extra: Partial<Record<string, unknown>> = {},
) {
  return {
    node_key: key,
    state,
    executor: null,
    capability: null,
    lifecycle_stage: stage,
    latency_ms: null,
    error_message: null,
    gate_kind: null,
    gate_state: null,
    provider: null,
    model: null,
    ...extra,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function respond(options: {
  runs?: unknown[];
  launch?: { body: unknown; status: number };
}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/graphs/runs")) {
      return Promise.resolve(json({ runs: options.runs ?? [] }));
    }
    if (typeof url === "string" && url.includes("/api/graphs") && init?.method === "POST") {
      return Promise.resolve(json(options.launch?.body ?? LAUNCH, options.launch?.status ?? 200));
    }
    return Promise.resolve(json(PROJECTS));
  });
}

async function propose(user: ReturnType<typeof userEvent.setup>, goal = "Build me a bakery site") {
  await user.type(screen.getByPlaceholderText("Build me…"), goal);
  await user.selectOptions(await screen.findByRole("combobox"), "11111111-1111-4111-8111-111111111111");
  await user.click(screen.getByRole("button", { name: "Build it" }));
}

async function launch(user: ReturnType<typeof userEvent.setup>, goal = "Build me a bakery site") {
  await propose(user, goal);
  // The Chief of Staff's proposal stands between the request and the launch.
  await user.click(await screen.findByRole("button", { name: "Approve & launch" }));
}

describe("the build workspace", () => {
  it("shows nothing about a run before anything has happened", async () => {
    respond({});
    render(<BuildWorkspace />);
    await screen.findByRole("combobox");

    expect(screen.queryByTestId("build-transcript")).not.toBeInTheDocument();
    expect(screen.queryByTestId("build-live-run")).not.toBeInTheDocument();
    expect(screen.queryByTestId("build-active-runs")).not.toBeInTheDocument();
  });

  it("points at Projects when the workspace has none — a build needs somewhere to land", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/graphs/runs")) {
        return Promise.resolve(json({ runs: [] }));
      }
      return Promise.resolve(json({ projects: [] }));
    });
    render(<BuildWorkspace />);

    const link = await screen.findByRole("link", { name: /Create a project first/ });
    expect(link).toHaveAttribute("href", "/solutions/projects");
  });

  it("drafts the plan for approval and launches nothing until it is approved", async () => {
    respond({});
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await propose(user);

    // The proposal is the real template read back: the request verbatim, the
    // dependency layers with assignments, and the human gates named.
    const proposal = await screen.findByTestId("build-proposal");
    expect(within(proposal).getByText("Build me a bakery site")).toBeInTheDocument();
    expect(within(proposal).getByText(/scan_internal — Research/)).toBeInTheDocument();
    expect(within(proposal).getByText(/architecture — Architecture ⛩ gate/)).toBeInTheDocument();
    expect(within(proposal).getByText(/3 steps \(architecture, test, deploy\) wait for your decision/)).toBeInTheDocument();
    expect(within(proposal).getByText(/Up to 3 steps run in parallel/)).toBeInTheDocument();

    // Approval is the launch boundary: no POST has happened yet.
    expect(fetchMock.mock.calls.some(([url, init]) =>
      typeof url === "string" && url.endsWith("/api/graphs")
      && (init as RequestInit | undefined)?.method === "POST")).toBe(false);

    await user.click(within(proposal).getByRole("button", { name: "Approve & launch" }));
    const call = fetchMock.mock.calls.find(([url, init]) =>
      typeof url === "string" && url.endsWith("/api/graphs") &&
      (init as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      projectId: "11111111-1111-4111-8111-111111111111",
      templateKey: "full_lifecycle",
      goal: "Build me a bakery site",
    });
  });

  it("withdraws the proposal on edit, keeping the words and launching nothing", async () => {
    respond({});
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await propose(user);

    const proposal = await screen.findByTestId("build-proposal");
    await user.click(within(proposal).getByRole("button", { name: "Edit the request" }));

    expect(screen.queryByTestId("build-proposal")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Build me…")).toHaveValue("Build me a bakery site");
    expect(fetchMock.mock.calls.some(([url, init]) =>
      typeof url === "string" && url.endsWith("/api/graphs")
      && (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("launches the real full_lifecycle workflow and reports the recorded plan", async () => {
    respond({});
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await launch(user);

    const call = fetchMock.mock.calls.find(([url, init]) =>
      typeof url === "string" && url.endsWith("/api/graphs") &&
      (init as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      projectId: "11111111-1111-4111-8111-111111111111",
      templateKey: "full_lifecycle",
      goal: "Build me a bakery site",
    });

    const transcript = await screen.findByTestId("build-transcript");
    expect(within(transcript).getByText("Build me a bakery site")).toBeInTheDocument();
    // The factory's entry states the recorded plan's real numbers…
    expect(within(transcript).getByText(/Plan recorded: 12 steps across the full lifecycle/)).toBeInTheDocument();
    // …and the server's own account of the worker wake, verbatim.
    expect(within(transcript).getByText("Worker woken through the project's GitHub binding.")).toBeInTheDocument();
  });

  it("shows a refusal in the server's words instead of pretending a run exists", async () => {
    respond({
      launch: {
        status: 409,
        body: { error: { message: "The project has no verified repository binding.", details: ["Connect GitHub first."] } },
      },
    });
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await launch(user);

    expect(
      await screen.findByText(/The project has no verified repository binding. — Connect GitHub first./),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("build-live-run")).not.toBeInTheDocument();
  });

  it("watches the launched run: counted progress, per-stage state, and the open gate", async () => {
    const runningRun = {
      graphRunId: "44444444-4444-4444-8444-444444444444",
      graphId: LAUNCH.graphId,
      goal: "Build me a bakery site",
      state: "RUNNING",
      projectId: "11111111-1111-4111-8111-111111111111",
      closureNote: null,
      startedAt: "2026-08-30T01:00:00Z",
      completedAt: null,
      isLifecycle: true,
      iteration: 1,
      maxIterations: 1,
      nodes: [
        node("goal", "GOAL", "COMPLETED"),
        node("arch", "ARCHITECTURE", "COMPLETED"),
        node("impl", "IMPLEMENTATION", "RUNNING"),
        node("review-gate", "REVIEW", "PLANNED", {
          gate_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          gate_kind: "HUMAN",
          gate_state: "OPEN",
        }),
      ],
    };
    respond({ runs: [runningRun] });
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await launch(user);

    const live = await screen.findByTestId("build-live-run");
    // Progress is the count of real node states, nothing smoother.
    expect(within(live).getByText(/2 of 4 steps complete, 1 running now/)).toBeInTheDocument();
    expect(within(live).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    // Stages render in lifecycle order with their own counts.
    expect(within(live).getByText("goal")).toBeInTheDocument();
    expect(within(live).getByText("implementation")).toBeInTheDocument();
    // The open human gate is a call to decide, with the evidence linked.
    expect(within(live).getByText(/One step is waiting for your approval/)).toBeInTheDocument();
    expect(within(live).getByRole("link", { name: "See the full evidence" })).toHaveAttribute(
      "href",
      `/solutions/lifecycle/run/${runningRun.graphRunId}`,
    );
  });

  it("decides an open gate inline through the real gate route", async () => {
    const gated = {
      graphRunId: "aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      graphId: LAUNCH.graphId,
      goal: "Build me a bakery site",
      state: "RUNNING",
      projectId: "11111111-1111-4111-8111-111111111111",
      startedAt: "2026-08-30T01:00:00Z",
      completedAt: null,
      isLifecycle: true,
      nodes: [
        node("arch-gate", "ARCHITECTURE", "VERIFYING", {
          gate_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          gate_kind: "HUMAN",
          gate_state: "OPEN",
        }),
      ],
    };
    respond({ runs: [gated] });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/graph-gates/")) {
        return Promise.resolve(json({ workerWoken: true, note: "Approved; the worker was woken." }));
      }
      if (typeof url === "string" && url.includes("/api/graphs/runs")) {
        return Promise.resolve(json({ runs: [gated] }));
      }
      if (typeof url === "string" && url.includes("/api/graphs") && init?.method === "POST") {
        return Promise.resolve(json(LAUNCH));
      }
      return Promise.resolve(json(PROJECTS));
    });
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await launch(user);

    const gates = await screen.findByTestId("build-gates");
    await user.click(within(gates).getByRole("button", { name: "Approve" }));

    // The decision goes to the shared gate route with the exact gate id…
    const call = fetchMock.mock.calls.find(([url]) =>
      typeof url === "string" && url.includes("/api/graph-gates/cccccccc-cccc-4ccc-8ccc-cccccccccccc/decide"));
    expect(call).toBeDefined();
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ approved: true });
    // …and the route's own note is what the person reads back.
    expect(await within(gates).findByText("Approved; the worker was woken.")).toBeInTheDocument();
  });

  it("reports completion with the run's own closure note in the transcript", async () => {
    const finished = {
      graphRunId: "55555555-5555-4555-8555-555555555555",
      graphId: LAUNCH.graphId,
      goal: "Build me a bakery site",
      state: "COMPLETED",
      projectId: "11111111-1111-4111-8111-111111111111",
      closureNote: "All eleven stages completed; two artifacts recorded.",
      startedAt: "2026-08-30T01:00:00Z",
      completedAt: "2026-08-30T01:20:00Z",
      isLifecycle: true,
      nodes: [node("goal", "GOAL", "COMPLETED")],
    };
    respond({ runs: [finished] });
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await launch(user);

    const transcript = await screen.findByTestId("build-transcript");
    await waitFor(() => {
      expect(
        within(transcript).getByText(/All eleven stages completed; two artifacts recorded\./),
      ).toBeInTheDocument();
    });
    expect(within(transcript).getByRole("link", { name: "Open the run" })).toBeInTheDocument();
  });

  it("shows the command center evidence: specialists over real nodes, QA verdicts, lazy artifacts", async () => {
    const evidenced = {
      graphRunId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      graphId: LAUNCH.graphId,
      goal: "Build me a bakery site",
      state: "RUNNING",
      projectId: "11111111-1111-4111-8111-111111111111",
      startedAt: "2026-08-30T03:00:00Z",
      completedAt: null,
      isLifecycle: true,
      tokensUsed: 12345,
      costMicros: 250000,
      verifications: [
        { subject_node_key: "implement-api", lens: "correctness", verdict: "PASS", verifier_provider: "anthropic" },
      ],
      nodes: [
        node("scout", "DISCOVERY", "COMPLETED", { capability: "discovery", provider: "anthropic", model: "claude-x" }),
        node("build-ui-page", "IMPLEMENTATION", "RUNNING", { capability: "implementation" }),
      ],
    };
    respond({ runs: [evidenced] });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/artifacts")) {
        return Promise.resolve(json({
          artifacts: [{ artifactId: "a1", nodeRunId: "n1", nodeKey: "scout", kind: "scout_report", payload: {}, createdAt: "2026-08-30T03:05:00Z" }],
        }));
      }
      if (typeof url === "string" && url.includes("/api/graphs/edges")) {
        return Promise.resolve(json({ edges: [{ from: "scout", to: "build-ui-page", reason: "SEQUENCE", detail: "" }] }));
      }
      if (typeof url === "string" && url.includes("/api/graphs/runs")) {
        return Promise.resolve(json({ runs: [evidenced] }));
      }
      if (typeof url === "string" && url.includes("/api/graphs") && init?.method === "POST") {
        return Promise.resolve(json(LAUNCH));
      }
      return Promise.resolve(json(PROJECTS));
    });
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await launch(user);

    // The Chief of Staff plan: intent verbatim, dependency layers from the
    // stored edges, assignments and the counted percent in the headline.
    const planPanel = await screen.findByTestId("build-plan");
    await user.click(within(planPanel).getByText(/Plan — composed by the Chief of Staff/));
    expect(within(planPanel).getByText("Build me a bakery site")).toBeInTheDocument();
    expect(within(planPanel).getByText(/scout — Research/)).toBeInTheDocument();
    expect(within(planPanel).getByText(/build-ui-page — Frontend/)).toBeInTheDocument();
    expect(screen.getByText(/50% — 1 of 2 steps complete/)).toBeInTheDocument();

    // Agents: the specialist role beside the real executor evidence.
    const agents = await screen.findByTestId("build-agents");
    await user.click(within(agents).getByText(/Agents \(2 steps\)/));
    expect(within(agents).getByText("Research")).toBeInTheDocument();
    expect(within(agents).getByText(/anthropic claude-x/)).toBeInTheDocument();
    // The engineering bench told apart by the node's own key.
    expect(within(agents).getByText("Frontend")).toBeInTheDocument();

    // QA: verdicts from graph_verifications, verifier named.
    const qa = screen.getByTestId("build-verifications");
    await user.click(within(qa).getByText(/Independent QA \(1 verdicts?\)/));
    expect(within(qa).getByText("PASS")).toBeInTheDocument();
    expect(within(qa).getByText(/verified by anthropic/)).toBeInTheDocument();

    // Artifacts fetch only when opened, from the real route.
    const artifactsPanel = screen.getByTestId("build-artifacts");
    expect(fetchMock.mock.calls.some(([url]) =>
      typeof url === "string" && url.includes("/artifacts"))).toBe(false);
    await user.click(within(artifactsPanel).getByText("Artifacts"));
    expect(await within(artifactsPanel).findByText("scout_report")).toBeInTheDocument();

    // Spend is the run's own accounting, never invented.
    expect(screen.getByText(/12,345 tokens · \$0\.2500/)).toBeInTheDocument();
  });

  it("shows the release trail from recorded anchor observations, diffs linked on the PR", async () => {
    const releasing = {
      graphRunId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      graphId: LAUNCH.graphId,
      goal: "Build me a bakery site",
      state: "RUNNING",
      projectId: "11111111-1111-4111-8111-111111111111",
      startedAt: "2026-08-30T05:00:00Z",
      completedAt: null,
      isLifecycle: true,
      nodes: [node("implement", "IMPLEMENTATION", "COMPLETED", { executor: "ANCHOR" })],
    };
    respond({ runs: [releasing] });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/artifacts")) {
        return Promise.resolve(json({
          artifacts: [
            {
              artifactId: "r1", nodeRunId: "n1", nodeKey: "implement", kind: "ANCHOR",
              createdAt: "2026-08-30T05:01:00Z",
              payload: {
                observation: "phase1c_change_lineage",
                repository: "factory/storefront",
                baseBranch: "main",
                baseSha: "a".repeat(40),
                headSha: "b".repeat(40),
                pullRequestNumber: 41,
                pullRequestUrl: "https://github.com/factory/storefront/pull/41",
                bridgeState: "PULL_REQUEST_RECORDED",
              },
            },
            {
              artifactId: "r2", nodeRunId: "n2", nodeKey: "test", kind: "ANCHOR",
              createdAt: "2026-08-30T05:02:00Z",
              payload: {
                observation: "ci_check_runs",
                sha: "b".repeat(40),
                repository: "factory/storefront",
                total: 1,
                checks: [{ name: "Lint, typecheck, test, and build", conclusion: "success", url: "https://github.com/x/1" }],
                failing: [],
              },
            },
          ],
        }));
      }
      if (typeof url === "string" && url.includes("/api/graphs/runs")) {
        return Promise.resolve(json({ runs: [releasing] }));
      }
      if (typeof url === "string" && url.includes("/api/graphs") && init?.method === "POST") {
        return Promise.resolve(json(LAUNCH));
      }
      return Promise.resolve(json(PROJECTS));
    });
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await launch(user);

    // The panel is lazy like Artifacts: nothing fetched until it opens.
    const release = await screen.findByTestId("build-release");
    expect(fetchMock.mock.calls.some(([url]) =>
      typeof url === "string" && url.includes("/artifacts"))).toBe(false);
    await user.click(within(release).getByText("Changes & release"));

    // The diffs live on the pull request — linked, never re-invented.
    const prLink = await within(release).findByRole("link", { name: "pull request #41" });
    expect(prLink).toHaveAttribute("href", "https://github.com/factory/storefront/pull/41/files");
    expect(within(release).getByText(/commit bbbbbbbb/)).toBeInTheDocument();
    // Test results carry each check's real conclusion.
    expect(within(release).getByRole("link", { name: "Lint, typecheck, test, and build" })).toBeInTheDocument();
    expect(within(release).getByText("success")).toBeInTheDocument();
  });

  it("shows the run's activity log verbatim from recorded events, fetched only on open", async () => {
    const logged = {
      graphRunId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      graphId: LAUNCH.graphId,
      goal: "Build me a bakery site",
      state: "RUNNING",
      projectId: "11111111-1111-4111-8111-111111111111",
      startedAt: "2026-08-30T05:00:00Z",
      completedAt: null,
      isLifecycle: true,
      nodes: [node("implement", "IMPLEMENTATION", "RUNNING")],
    };
    respond({ runs: [logged] });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/events")) {
        return Promise.resolve(json({
          events: [{
            eventId: "e1",
            eventType: "node_running",
            detail: "worker graph-worker-test attempt 2",
            nodeKey: "implement",
            createdAt: "2026-08-30T05:01:22.000Z",
          }],
          truncated: false,
        }));
      }
      if (typeof url === "string" && url.includes("/api/graphs/runs")) {
        return Promise.resolve(json({ runs: [logged] }));
      }
      if (typeof url === "string" && url.includes("/api/graphs") && init?.method === "POST") {
        return Promise.resolve(json(LAUNCH));
      }
      return Promise.resolve(json(PROJECTS));
    });
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await launch(user);

    const log = await screen.findByTestId("build-events");
    expect(fetchMock.mock.calls.some(([url]) =>
      typeof url === "string" && url.includes("/events"))).toBe(false);
    await user.click(within(log).getByText("Activity log"));

    // The line is the recorded event, verbatim: time, type, node, detail.
    expect(await within(log).findByText(/05:01:22/)).toBeInTheDocument();
    expect(within(log).getByText(/node_running · implement — worker graph-worker-test attempt 2/)).toBeInTheDocument();
    expect(within(log).queryByText(/Showing the newest 500 events/)).not.toBeInTheDocument();
  });

  it("stops a just-launched build through the real withdrawal route", async () => {
    respond({});
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/withdraw")) {
        return Promise.resolve(json({
          graphId: LAUNCH.graphId,
          withdrawnAt: "2026-08-30T07:00:00Z",
          note: "The graph is withdrawn: no worker will claim it again. Nothing already running was interrupted.",
        }));
      }
      if (typeof url === "string" && url.includes("/api/graphs/runs")) {
        return Promise.resolve(json({ runs: [] }));
      }
      if (typeof url === "string" && url.includes("/api/graphs") && init?.method === "POST") {
        return Promise.resolve(json(LAUNCH));
      }
      return Promise.resolve(json(PROJECTS));
    });
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await launch(user);

    const waiting = await screen.findByTestId("build-awaiting-run");
    expect(waiting).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));

    const call = fetchMock.mock.calls.find(([url]) =>
      typeof url === "string" && url.includes(`/api/graphs/${LAUNCH.graphId}/withdraw`));
    expect(call).toBeDefined();
    // The server's own sentence lands in the transcript, and the waiting
    // card leaves with the launch it described.
    const transcript = await screen.findByTestId("build-transcript");
    expect(within(transcript).getByText(/no worker will claim it again/)).toBeInTheDocument();
    expect(screen.queryByTestId("build-awaiting-run")).not.toBeInTheDocument();
  });

  it("keeps terminal cancelled runs out of Already building", async () => {
    respond({
      runs: [
        {
          graphRunId: "66666666-6666-4666-8666-666666666666",
          graphId: "77777777-7777-4777-8777-777777777777",
          goal: "Live claim",
          state: "RUNNING",
          projectId: "22222222-2222-4222-8222-222222222222",
          isLifecycle: true,
          startedAt: "2026-08-30T00:00:00Z",
          completedAt: null,
          nodes: [node("goal", "GOAL", "RUNNING")],
        },
        {
          graphRunId: "88888888-8888-4888-8888-888888888889",
          graphId: "99999999-9999-4999-8999-999999999998",
          goal: "Voided run, graph still claimable",
          state: "CANCELLED",
          projectId: "22222222-2222-4222-8222-222222222222",
          isLifecycle: true,
          startedAt: "2026-08-30T00:00:00Z",
          completedAt: null,
          nodes: [node("goal", "GOAL", "CANCELLED")],
        },
      ],
    });
    render(<BuildWorkspace />);

    const active = await screen.findByTestId("build-active-runs");
    const rows = within(active).getAllByRole("listitem");
    const liveRow = rows.find((row) => within(row).queryByText("Live claim") !== null)!;
    expect(within(liveRow).queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(within(active).queryByText(/Voided run/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("build-history")).getByText(/Voided run/)).toBeInTheDocument();
  });

  it("pauses a running build and resumes a paused one through the real pause route", async () => {
    const runningGraphId = "77777777-7777-4777-8777-777777777777";
    const pausedGraphId = "99999999-9999-4999-8999-999999999998";
    respond({});
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/pause")) {
        const paused = (JSON.parse((init?.body as string) ?? "{}") as { paused?: boolean }).paused;
        return Promise.resolve(json({
          graphId: runningGraphId,
          pausedAt: paused ? "2026-08-30T08:00:00Z" : null,
          workerWoken: !paused,
          note: paused
            ? "The graph is paused: running work finishes its current step, nothing new starts, and no worker will claim it until it is resumed."
            : "The graph is resumed and the executor worker has been woken to pick it back up. Completed work carries forward.",
        }));
      }
      if (typeof url === "string" && url.includes("/api/graphs/runs")) {
        return Promise.resolve(json({
          runs: [
            {
              graphRunId: "66666666-6666-4666-8666-666666666666",
              graphId: runningGraphId,
              goal: "Live claim",
              state: "RUNNING",
              projectId: "22222222-2222-4222-8222-222222222222",
              isLifecycle: true,
              startedAt: "2026-08-30T00:00:00Z",
              completedAt: null,
              pausedAt: null,
              nodes: [node("goal", "GOAL", "RUNNING")],
            },
            {
              graphRunId: "88888888-8888-4888-8888-888888888889",
              graphId: pausedGraphId,
              goal: "Held build",
              state: "CANCELLED",
              projectId: "22222222-2222-4222-8222-222222222222",
              isLifecycle: true,
              startedAt: "2026-08-30T00:00:00Z",
              completedAt: null,
              pausedAt: "2026-08-30T07:30:00Z",
              nodes: [node("goal", "GOAL", "COMPLETED"), node("plan", "PLAN", "SKIPPED")],
            },
          ],
        }));
      }
      return Promise.resolve(json(PROJECTS));
    });
    const user = userEvent.setup();
    render(<BuildWorkspace />);

    const active = await screen.findByTestId("build-active-runs");
    const rows = within(active).getAllByRole("listitem");
    const liveRow = rows.find((row) => within(row).queryByText("Live claim") !== null)!;
    const heldRow = rows.find((row) => within(row).queryByText("Held build") !== null)!;

    // The live claim offers Pause (the honest control for a running claim);
    // the held build says it is paused and offers Resume.
    expect(within(heldRow).getByText(/paused ·/)).toBeInTheDocument();
    expect(within(liveRow).queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(within(heldRow).queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();

    await user.click(within(liveRow).getByRole("button", { name: "Pause" }));
    const pauseCall = fetchMock.mock.calls.find(([url]) =>
      typeof url === "string" && url.includes(`/api/graphs/${runningGraphId}/pause`));
    expect(pauseCall).toBeDefined();
    expect(JSON.parse((pauseCall?.[1] as RequestInit).body as string)).toEqual({ paused: true });

    await user.click(within(heldRow).getByRole("button", { name: "Resume" }));
    const resumeCall = fetchMock.mock.calls.find(([url]) =>
      typeof url === "string" && url.includes(`/api/graphs/${pausedGraphId}/pause`));
    expect(resumeCall).toBeDefined();
    expect(JSON.parse((resumeCall?.[1] as RequestInit).body as string)).toEqual({ paused: false });

    // The server's own sentences land in the transcript, never a paraphrase.
    const transcript = await screen.findByTestId("build-transcript");
    expect(within(transcript).getByText(/nothing new starts/)).toBeInTheDocument();
    expect(within(transcript).getByText(/woken to pick it back up/)).toBeInTheDocument();
  });

  it("derives the autonomy mode from real controls and shows the fence's refusal verbatim", async () => {
    respond({});
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/controls")) {
        if (init?.method === "PATCH") {
          return Promise.resolve(json(
            { error: { code: "invalid_controls", message: "Project control update is invalid." } },
            400,
          ));
        }
        return Promise.resolve(json({
          projectId: "11111111-1111-4111-8111-111111111111",
          controls: {
            autonomousMode: false,
            maximumAutonomousRisk: "green",
            autoApprove: false,
            autoMerge: false,
            autoDeploy: false,
            autoRollback: false,
            updatedAt: "2026-08-30T07:00:00.000Z",
          },
        }));
      }
      if (typeof url === "string" && url.includes("/api/graphs/runs")) {
        return Promise.resolve(json({ runs: [] }));
      }
      return Promise.resolve(json(PROJECTS));
    });
    const user = userEvent.setup();
    render(<BuildWorkspace />);
    await user.selectOptions(await screen.findByRole("combobox"), "11111111-1111-4111-8111-111111111111");

    // The mode is derived from the stored controls, never assumed.
    const panel = await screen.findByTestId("build-autonomy");
    expect(await within(panel).findByText(/Autonomy — Ask Me/)).toBeInTheDocument();
    await user.click(within(panel).getByText(/Autonomy — Ask Me/));
    expect(within(panel).getByRole("button", { name: "Ask Me — active" })).toBeDisabled();

    // Selecting a stronger mode is a real request with the exact patch…
    await user.click(within(panel).getByRole("button", { name: "Autonomous" }));
    const call = fetchMock.mock.calls.find(([url, init]) =>
      typeof url === "string" && url.includes("/controls")
      && (init as RequestInit | undefined)?.method === "PATCH");
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      autonomousMode: true,
      maximumAutonomousRisk: "yellow",
      expectedUpdatedAt: "2026-08-30T07:00:00.000Z",
    });
    // …and the server's refusal is the answer, in its own words.
    expect(await within(panel).findByText("Project control update is invalid.")).toBeInTheDocument();
  });

  it("lists unfinished lifecycle runs on arrival, so watching resumes across visits", async () => {
    respond({
      runs: [
        {
          graphRunId: "66666666-6666-4666-8666-666666666666",
          graphId: "77777777-7777-4777-8777-777777777777",
          goal: "Ship the pricing page",
          state: "RUNNING",
          projectId: "22222222-2222-4222-8222-222222222222",
          isLifecycle: true,
          startedAt: "2026-08-30T00:00:00Z",
          completedAt: null,
          nodes: [node("goal", "GOAL", "COMPLETED"), node("impl", "IMPLEMENTATION", "RUNNING")],
        },
        {
          graphRunId: "88888888-8888-4888-8888-888888888888",
          graphId: "99999999-9999-4999-8999-999999999999",
          goal: "Old finished work",
          state: "COMPLETED",
          projectId: "22222222-2222-4222-8222-222222222222",
          isLifecycle: true,
          startedAt: "2026-08-29T00:00:00Z",
          completedAt: "2026-08-29T01:00:00Z",
          nodes: [node("goal", "GOAL", "COMPLETED")],
        },
      ],
    });
    render(<BuildWorkspace />);

    const active = await screen.findByTestId("build-active-runs");
    expect(within(active).getByText("Ship the pricing page")).toBeInTheDocument();
    expect(within(active).getByText(/1\/2 steps/)).toBeInTheDocument();
    // Finished work is history, not "already building" — it lands in the
    // history card with a link to its evidence.
    expect(within(active).queryByText("Old finished work")).not.toBeInTheDocument();
    const history = screen.getByTestId("build-history");
    expect(within(history).getByText("Old finished work")).toBeInTheDocument();
    expect(within(history).getByRole("link", { name: "Evidence" })).toHaveAttribute(
      "href",
      "/solutions/lifecycle/run/88888888-8888-4888-8888-888888888888",
    );
  });
});
