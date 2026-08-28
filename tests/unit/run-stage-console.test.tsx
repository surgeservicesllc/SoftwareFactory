import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunStageConsole } from "@/components/graph/run-stage-console";

/**
 * The per-run stage page, from the owner's boards.
 *
 * What these cases pin is the page's honesty contract: everything shown is a
 * stored fact. The request is the run's goal verbatim; the strip's counts are
 * the summariser's; the breakdown is the recorded package itself (structured
 * when a contract recognises it, verbatim JSON when none does); the decision
 * control is the same shared gate component the runs panel uses; and a run
 * the projection cannot see is said to be unseen, not invented.
 */

const RUN_ID = "80000000-0000-4000-8000-0000000000d1";

const node = (overrides: Record<string, unknown> = {}) => ({
  node_key: "decide",
  executor: "MODEL",
  capability: "decision",
  state: "COMPLETED",
  provider: "anthropic",
  model: "m",
  latency_ms: 900,
  error_message: null,
  lifecycle_stage: "DECISION",
  gate_kind: null,
  gate_id: null,
  gate_state: null,
  job: "Weigh the five paths and choose one.",
  queued_at: "2026-08-24T12:00:00.000Z",
  node_started_at: "2026-08-24T12:00:05.000Z",
  node_completed_at: "2026-08-24T12:01:35.000Z",
  ...overrides,
});

const decisionPayload = {
  schemaVersion: 1,
  paths: ["USE", "CONNECT", "ADAPT", "FORK", "BUILD"].map((path) => ({
    path,
    score: path === "USE" ? 88 : 40,
    pros: ["A stated advantage"],
    cons: ["A stated cost"],
    fitNotes: "How it fits.",
  })),
  chosenPath: "USE",
  subject: "existing-library",
  rationale: ["It already does the work."],
  executionPlan: [{ step: "Adopt it", detail: "Wire the existing surface in." }],
  integrationBoundaries: { weOwn: ["the caller"], counterpartOwns: ["the library"] },
  risks: [],
  openQuestions: [],
};

function runPayload(nodes: readonly Record<string, unknown>[]) {
  return {
    runs: [
      {
        graphRunId: RUN_ID,
        graphId: "70000000-0000-4000-8000-0000000000d1",
        goal: "One request through all ten phases.",
        topology: "DIAMOND",
        state: "PARTIAL",
        hadPartialInput: true,
        startedAt: "2026-08-24T12:00:00.000Z",
        completedAt: null,
        nodes,
        artifactCounts: {},
        verifications: [
          {
            subject_node_key: "decide",
            lens: "review",
            verdict: "PASS",
            evidence: [],
            verifier_provider: "anthropic",
            shared_worker_context: false,
          },
        ],
        isLifecycle: true,
        iteration: 1,
        maxIterations: 3,
      },
    ],
  };
}

let gateCalls: { url: string; body: unknown }[] = [];

function stubFetch(options: {
  runs?: unknown;
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
    return Promise.resolve({
      ok: true, status: 200, json: async () => options.runs ?? { runs: [] },
    } as Response);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const artifact = (overrides: Record<string, unknown> = {}) => ({
  artifactId: "a0000000-0000-4000-8000-000000000001",
  nodeRunId: "b0000000-0000-4000-8000-000000000001",
  nodeKey: "decide",
  kind: "REDUCED",
  payload: decisionPayload,
  createdAt: "2026-08-24T12:01:30.000Z",
  ...overrides,
});

describe("the per-run stage page", () => {
  it("shows the request verbatim and the full stage strip with the current stage marked", async () => {
    stubFetch({ runs: runPayload([node()]) });
    render(<RunStageConsole graphRunId={RUN_ID} stage="DECISION" />);

    expect(await screen.findByText("One request through all ten phases.")).toBeInTheDocument();
    const strip = screen.getByRole("navigation", { name: /This run's stages/i });
    // All eleven stages, in order, each a link into this same run.
    const links = within(strip).getAllByRole("link");
    expect(links).toHaveLength(11);
    expect(links[0]).toHaveTextContent("1. GOAL");
    expect(links[4]).toHaveAttribute("aria-current", "page");
    expect(links[4].getAttribute("href")).toBe(`/solutions/lifecycle/run/${RUN_ID}/decision`);
    // The node's stored job appears both as the stage's brief and on its row.
    expect(screen.getAllByText(/Weigh the five paths and choose one/).length).toBeGreaterThan(0);
  });

  it("renders a recorded decision package structurally, from its own fields", async () => {
    stubFetch({ runs: runPayload([node()]), artifacts: [artifact()] });
    render(<RunStageConsole graphRunId={RUN_ID} stage="DECISION" />);

    expect(await screen.findByText("USE")).toBeInTheDocument();
    expect(screen.getByText("existing-library")).toBeInTheDocument();
    expect(screen.getByText("It already does the work.")).toBeInTheDocument();
    expect(screen.getByText("Adopt it")).toBeInTheDocument();
    // The verification the run recorded on this stage's work is present too.
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });

  it("shows an unrecognised payload verbatim rather than paraphrasing it", async () => {
    stubFetch({
      runs: runPayload([node()]),
      artifacts: [artifact({ payload: { observation: "checks green", commit: "abc123" } })],
    });
    render(<RunStageConsole graphRunId={RUN_ID} stage="DECISION" />);

    const raw = await screen.findByText(/"observation": "checks green"/);
    expect(raw).toBeInTheDocument();
  });

  it("offers the open gate's decision through the shared control and route", async () => {
    stubFetch({
      runs: runPayload([
        node({
          node_key: "architecture",
          lifecycle_stage: "ARCHITECTURE",
          capability: "architecture",
          state: "VERIFYING",
          gate_kind: "HUMAN",
          gate_id: "a0000000-0000-4000-8000-000000000009",
          gate_state: "OPEN",
          gate_anchor_count: 0,
          job: "Design the change.",
        }),
      ]),
    });
    const user = userEvent.setup();
    render(<RunStageConsole graphRunId={RUN_ID} stage="ARCHITECTURE" />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(gateCalls).toHaveLength(1));
    expect(gateCalls[0].url).toContain("a0000000-0000-4000-8000-000000000009");
    expect(gateCalls[0].body).toEqual({ approved: true });
  });

  it("lists only stored clocks in the activity log", async () => {
    stubFetch({ runs: runPayload([node()]) });
    render(<RunStageConsole graphRunId={RUN_ID} stage="DECISION" />);

    await screen.findByText("One request through all ten phases.");
    expect(screen.getByText("decide queued")).toBeInTheDocument();
    expect(screen.getByText("decide started")).toBeInTheDocument();
    expect(screen.getByText("decide completed")).toBeInTheDocument();
  });

  it("reads a recorded model-node report as a report, not as raw JSON", async () => {
    stubFetch({
      runs: runPayload([node()]),
      artifacts: [artifact({
        payload: {
          blocked: false,
          summary: "I weighed the shortlist against the constraints.",
          findings: [{ title: "CANDIDATE alpha — matchScore 92", detail: "Evidence: package.json line 12." }],
          confidence: "high",
          blocked_reason: null,
          recommendations: ["Carry the labels forward unchanged."],
        },
      })],
    });
    render(<RunStageConsole graphRunId={RUN_ID} stage="DECISION" />);

    expect(await screen.findByText("I weighed the shortlist against the constraints.")).toBeInTheDocument();
    expect(screen.getByText("CANDIDATE alpha — matchScore 92")).toBeInTheDocument();
    expect(screen.getByText("confidence: high")).toBeInTheDocument();
    expect(screen.getByText("Carry the labels forward unchanged.")).toBeInTheDocument();
    // The finding's evidence is behind its own disclosure, not dumped inline.
    expect(screen.getByText("Evidence: package.json line 12.")).toBeInTheDocument();
  });

  it("sums the scouts honestly on the Discover step, and only there", async () => {
    const scout = (key: string, count: number, confidence: string) => artifact({
      artifactId: `a0000000-0000-4000-8000-00000000000${count}`,
      nodeKey: key,
      payload: {
        blocked: false,
        summary: `${key} report.`,
        findings: Array.from({ length: count }, (_, index) => ({ title: `${key} finding ${index + 1}`, detail: "" })),
        confidence,
        recommendations: [],
      },
    });
    const scanNodes = ["scan_internal", "scan_dependencies", "recall_ecosystem", "consolidate"].map(
      (key) => node({ node_key: key, lifecycle_stage: "DISCOVERY", capability: "discovery" }),
    );
    stubFetch({
      runs: runPayload(scanNodes),
      artifacts: [
        scout("scan_internal", 3, "high"),
        scout("scan_dependencies", 2, "high"),
        scout("recall_ecosystem", 4, "medium"),
        scout("consolidate", 5, "medium"),
      ],
    });
    render(<RunStageConsole graphRunId={RUN_ID} stage="DISCOVERY" />);

    expect(await screen.findByText("What the scouts searched")).toBeInTheDocument();
    expect(screen.getByText("This repository")).toBeInTheDocument();
    expect(screen.getByText("Ecosystem recall (model knowledge)")).toBeInTheDocument();
    // The dedup sentence is arithmetic over recorded findings, nothing more.
    expect(
      screen.getByText(/The 3 scans recorded 9 findings; the consolidated shortlist carries 5\./),
    ).toBeInTheDocument();
  });

  it("reads a TEST anchor's CI observation as a verdict, not as JSON", async () => {
    stubFetch({
      runs: runPayload([node({ node_key: "test", lifecycle_stage: "TEST", capability: "qa", executor: "ANCHOR" })]),
      artifacts: [artifact({
        nodeKey: "test",
        kind: "ANCHOR",
        payload: {
          observation: "ci_check_runs",
          sha: "b1771b1b5a6c82b55f3d68f02b7e5a251380aca8",
          repository: "owner/repository",
          total: 4,
          checks: [
            { name: "CI 1", conclusion: "success", url: "https://github.com/owner/repository/actions/runs/1" },
            { name: "CI 2", conclusion: "success", url: "https://github.com/owner/repository/actions/runs/2" },
            { name: "CI 3", conclusion: "success", url: "https://github.com/owner/repository/actions/runs/3" },
            { name: "CI 4", conclusion: "success", url: "https://github.com/owner/repository/actions/runs/4" },
          ],
          failing: [],
          observedAt: "2026-08-24T12:05:00.000Z",
          latencyMs: 412,
        },
      })],
    });
    render(<RunStageConsole graphRunId={RUN_ID} stage="TEST" />);

    expect(await screen.findByText("CI green")).toBeInTheDocument();
    expect(screen.getByText("b1771b1b")).toBeInTheDocument();
    expect(screen.getByText(/4 check runs for commit/)).toBeInTheDocument();
  });

  it("reads a MONITOR anchor's probe as a reading with its status", async () => {
    stubFetch({
      runs: runPayload([node({ node_key: "monitor", lifecycle_stage: "MONITORING", capability: "synthesis", executor: "ANCHOR" })]),
      artifacts: [artifact({
        nodeKey: "monitor",
        kind: "ANCHOR",
        payload: {
          observation: "production_http_probe",
          url: "https://www.example.org/",
          status: 200,
          healthy: true,
          observedAt: "2026-08-24T12:06:00.000Z",
          latencyMs: 180,
        },
      })],
    });
    render(<RunStageConsole graphRunId={RUN_ID} stage="MONITORING" />);

    expect(await screen.findByText("HTTP 200")).toBeInTheDocument();
    expect(screen.getByText("https://www.example.org/")).toBeInTheDocument();
    expect(screen.getByText(/One live probe of production/)).toBeInTheDocument();
  });

  it("says plainly when the run is not among the readable runs", async () => {
    stubFetch({ runs: { runs: [] } });
    render(<RunStageConsole graphRunId={RUN_ID} stage="DECISION" />);

    expect(
      await screen.findByText(/This run is not in the newest hundred/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Pipelines" })).toBeInTheDocument();
  });

  it("says a stage with no nodes in this run has none, without inventing rows", async () => {
    stubFetch({ runs: runPayload([node()]) });
    render(<RunStageConsole graphRunId={RUN_ID} stage="DEPLOYMENT" />);

    expect(
      await screen.findByText("This run planned no node in this stage."),
    ).toBeInTheDocument();
  });
});
