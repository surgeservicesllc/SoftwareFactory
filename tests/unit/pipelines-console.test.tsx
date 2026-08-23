import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PipelinesConsole, pipelineStage, type PipelineTemplateSummary } from "@/components/pipelines-console";

const searchParams = vi.fn(() => new URLSearchParams());
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams() }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const templates: PipelineTemplateSummary[] = [
  {
    key: "feature_build",
    name: "Feature Build",
    category: "BUILD",
    summary: "Plan, build, and verify a feature.",
    version: 3,
    topology: "DAG",
    nodeCount: 6,
    maxParallelism: 2,
    anchorNodeCount: 0,
    compiles: true,
  },
];

function command(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    prompt: `Goal ${id}`,
    risk: "YELLOW",
    status,
    submittedAt: "2026-08-17T10:00:00.000Z",
    completedAt: null,
    project: { id: "p1", name: "SoftwareFactory" },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  searchParams.mockReset();
  searchParams.mockReturnValue(new URLSearchParams());
});

describe("pipelineStage", () => {
  it("maps every worker-advanced status to a human stage", () => {
    expect(pipelineStage("queued").label).toBe("Planning");
    expect(pipelineStage("running").label).toBe("Building");
    expect(pipelineStage("succeeded")).toMatchObject({ label: "Complete", tone: "safe" });
    expect(pipelineStage("failed")).toMatchObject({ label: "Failed", tone: "danger" });
    expect(pipelineStage("awaiting_approval")).toMatchObject({ needsOwner: true });
  });
});

describe("PipelinesConsole", () => {
  it("shows only live lifecycle stages on Active, with owner attention counted", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/commands") {
        return jsonResponse({ commands: [
          command("c1", "running"),
          command("c2", "awaiting_approval", { risk: "RED" }),
          command("c3", "succeeded", { completedAt: "2026-08-17T11:00:00.000Z" }),
          command("c4", "failed", { completedAt: "2026-08-17T11:30:00.000Z" }),
        ] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<PipelinesConsole templates={templates} />);

    expect(await screen.findByText("Goal c1")).toBeInTheDocument();
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByText("Waiting for your approval")).toBeInTheDocument();
    // Finished runs are not in the Active list.
    expect(screen.queryByText("Goal c3")).not.toBeInTheDocument();
    // The summary counts come from the same records.
    expect(screen.getByText("Active now").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Need your approval").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Completed").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Failed").parentElement).toHaveTextContent("1");
  });

  it("shows the whole history with outcomes and durations on All Pipelines", async () => {
    searchParams.mockReturnValue(new URLSearchParams("view=all"));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ commands: [
      command("c3", "succeeded", { completedAt: "2026-08-17T11:00:00.000Z" }),
    ] })));

    render(<PipelinesConsole templates={templates} />);

    expect(await screen.findByText("Goal c3")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText(/took 1 h 0 min/)).toBeInTheDocument();
  });

  it("renders the versioned compiled templates with real topology facts", async () => {
    searchParams.mockReturnValue(new URLSearchParams("view=templates"));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: false });
      return jsonResponse({ commands: [] });
    }));

    render(<PipelinesConsole templates={templates} />);

    const builtIns = (await screen.findByText("Feature Build")).closest("section") as HTMLElement;
    expect(within(builtIns).getByText("v3")).toBeInTheDocument();
    expect(within(builtIns).getByText(/DAG · 6 nodes · up to 2 in parallel/)).toBeInTheDocument();
    // Deep compiled previews stay on Workflows — one engine, one source.
    expect(screen.getByRole("link", { name: "Workflows" })).toHaveAttribute("href", "/solutions/workflows");
  });

  it("renders recorded graph runs with node truth on the Graph runs view", async () => {
    searchParams.mockReturnValue(new URLSearchParams("view=graphs"));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/graphs/runs") {
        return jsonResponse({ runs: [
          {
            graphRunId: "r1",
            graphId: "g1",
            goal: "Checks the things that break on the first real day",
            topology: "DIAMOND",
            riskLevel: "green",
            projectId: "p1",
            state: "PARTIAL",
            hadPartialInput: true,
            startedAt: "2026-08-19T03:00:00.000Z",
            completedAt: "2026-08-19T03:05:00.000Z",
            nodes: [
              { node_key: "config", executor: "MODEL", capability: "review", state: "COMPLETED", provider: "anthropic", model: "claude-opus-5", latency_ms: 42_000, error_message: null },
              { node_key: "reduce", executor: "DETERMINISTIC", capability: "extraction", state: "COMPLETED", provider: "deterministic", model: null, latency_ms: 3, error_message: null },
              { node_key: "rollback", executor: "MODEL", capability: "review", state: "FAILED", provider: "anthropic", model: "claude-opus-5", latency_ms: 9_000, error_message: "The area could not be read." },
            ],
            artifactCounts: { RAW: 2 },
            verifications: [
              {
                subject_node_key: "config",
                lens: "correctness",
                verdict: "REJECT",
                evidence: ["high: Unbounded query"],
                verifier_provider: "anthropic",
                shared_worker_context: false,
              },
            ],
          },
        ] });
      }
      return jsonResponse({ commands: [] });
    }));

    render(<PipelinesConsole templates={templates} />);

    expect(await screen.findByText("Checks the things that break on the first real day")).toBeInTheDocument();
    expect(screen.getByText("PARTIAL")).toBeInTheDocument();
    // Node truth verbatim: states, the deterministic attribution, the error.
    expect(screen.getByText("reduce")).toBeInTheDocument();
    expect(screen.getByText("deterministic")).toBeInTheDocument();
    expect(screen.getByText("The area could not be read.")).toBeInTheDocument();
    expect(screen.getByText(/Inputs were incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/2 RAW/)).toBeInTheDocument();
    // A recorded verdict is shown with its subject, lens, and cited evidence.
    expect(screen.getByText("Verifications")).toBeInTheDocument();
    expect(screen.getByText("REJECT")).toBeInTheDocument();
    expect(screen.getByText("correctness")).toBeInTheDocument();
    expect(screen.getByText("high: Unbounded query")).toBeInTheDocument();
  });

  it("renders a run from a payload that predates verifications", async () => {
    // This is JSON off the network. A response from an older deployment, or
    // one truncated by a partial rollout, must render the run it does have
    // rather than blanking the whole view on a missing key.
    searchParams.mockReturnValue(new URLSearchParams("view=graphs"));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/graphs/runs") {
        return jsonResponse({ runs: [
          {
            graphRunId: "r9", graphId: "g9", goal: "An older payload", topology: "DAG",
            riskLevel: "green", projectId: "p1", state: "COMPLETED", hadPartialInput: false,
            startedAt: null, completedAt: null, nodes: [], artifactCounts: {},
          },
        ] });
      }
      return jsonResponse({ commands: [] });
    }));

    render(<PipelinesConsole templates={templates} />);

    expect(await screen.findByText("An older payload")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  });

  it("names the next step when no graph run exists yet", async () => {
    searchParams.mockReturnValue(new URLSearchParams("view=graphs"));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/graphs/runs") return jsonResponse({ runs: [] });
      return jsonResponse({ commands: [] });
    }));

    render(<PipelinesConsole templates={templates} />);

    expect(await screen.findByText("No graph runs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open templates/i })).toHaveAttribute(
      "href",
      "/solutions/pipelines?view=templates",
    );
  });

  it("sends an empty workspace to the composer and gates a signed-out visitor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ commands: [] })));
    const { unmount } = render(<PipelinesConsole templates={templates} />);
    expect(await screen.findByText("Nothing is running")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start a pipeline/i })).toHaveAttribute(
      "href",
      "/solutions/bot-manager",
    );
    unmount();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));
    render(<PipelinesConsole templates={templates} />);
    expect(await screen.findByText("Sign in to see your pipelines")).toBeInTheDocument();
  });

  it("deletes only the pipelines ticked, and reports what the database kept", async () => {
    searchParams.mockReturnValue(new URLSearchParams("view=all"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/commands/delete") {
        return jsonResponse({
          deleted: { deletedCount: 1, keptRunning: 1, keptWithRuns: 0, notFound: 0 },
        });
      }
      void init;
      return jsonResponse({ commands: [
        command("c1", "succeeded", { completedAt: "2026-08-17T11:00:00.000Z" }),
        command("c2", "running"),
      ] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PipelinesConsole templates={templates} />);
    await screen.findByText("Goal c1");

    // Nothing ticked: the control is present but inert, so an accidental
    // press cannot delete a list nobody chose.
    const deleteButton = screen.getByRole("button", { name: "Delete selected" });
    expect(deleteButton).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: "Select pipeline: Goal c1" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select pipeline: Goal c2" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));

    // The first press asks; a reason under ten characters keeps it asking.
    const confirm = screen.getByRole("button", { name: /yes, delete these pipelines/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason/i), "tidying the pipelines list");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    const call = fetchMock.mock.calls.find(([url]) => String(url) === "/api/commands/delete");
    expect(call).toBeDefined();
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      commandIds: ["c1", "c2"],
      reason: "tidying the pipelines list",
      includeCommandsWithRuns: false,
    });
    // Two were sent, one came back deleted: the message says so rather than
    // claiming the selection is gone.
    expect(await screen.findByText("1 pipeline deleted. Kept: 1 still running.")).toBeInTheDocument();
  });

  it("ticks and unticks every visible row from the header checkbox", async () => {
    searchParams.mockReturnValue(new URLSearchParams("view=all"));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ commands: [
      command("c1", "succeeded", { completedAt: "2026-08-17T11:00:00.000Z" }),
      command("c2", "failed", { completedAt: "2026-08-17T11:30:00.000Z" }),
    ] })));

    render(<PipelinesConsole templates={templates} />);
    await screen.findByText("Goal c1");

    await userEvent.click(screen.getByRole("checkbox", { name: "Select all 2" }));
    expect(screen.getByRole("button", { name: "Delete selected (2)" })).toBeEnabled();
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "2 of 2 selected" }));
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
  });
});
