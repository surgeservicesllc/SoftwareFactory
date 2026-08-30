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

async function launch(user: ReturnType<typeof userEvent.setup>, goal = "Build me a bakery site") {
  await user.type(screen.getByPlaceholderText("Build me…"), goal);
  await user.selectOptions(await screen.findByRole("combobox"), "11111111-1111-4111-8111-111111111111");
  await user.click(screen.getByRole("button", { name: "Build it" }));
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
        node("review-gate", "REVIEW", "PLANNED", { gate_kind: "HUMAN", gate_state: "OPEN" }),
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
    // The open human gate is a call to decide, linked to the run page.
    expect(within(live).getByText(/One step is waiting for your approval/)).toBeInTheDocument();
    expect(within(live).getByRole("link", { name: "Review and decide" })).toHaveAttribute(
      "href",
      `/solutions/lifecycle/run/${runningRun.graphRunId}`,
    );
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
    // Finished work is history, not "already building".
    expect(within(active).queryByText("Old finished work")).not.toBeInTheDocument();
  });
});
