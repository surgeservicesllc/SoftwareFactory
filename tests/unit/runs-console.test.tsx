import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunsConsole, runStatusLabel } from "@/components/runs-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const succeededRun = {
  id: "run-1",
  status: "succeeded",
  startedAt: "2026-08-16T01:00:00.000Z",
  completedAt: "2026-08-16T01:05:00.000Z",
  createdAt: "2026-08-16T00:59:00.000Z",
  durationMs: 300_000,
  risk: "green",
  provider: "openai",
  model: "worker-model",
  branch: "factory/run-1",
  project: { id: "project-1", name: "SoftwareFactory" },
  task: { id: "task-1", title: "Canary documentation" },
  agent: { id: "agent-1", name: "Codex worker" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

describe("runStatusLabel", () => {
  it("maps each recorded run_status value to plain language, one to one", () => {
    expect(runStatusLabel("queued")).toBe("Waiting for a worker");
    expect(runStatusLabel("running")).toBe("A worker is on it");
    expect(runStatusLabel("succeeded")).toBe("Finished");
    expect(runStatusLabel("failed")).toBe("Failed — needs a look");
    expect(runStatusLabel("cancelled")).toBe("Stopped");
  });

  it("falls back to the raw word for anything unrecognized, never a guess", () => {
    expect(runStatusLabel("awaiting_approval")).toBe("awaiting approval");
  });

  it("says the two graph-only states finished, because they have", () => {
    // Both are terminal. Before the run list read graph runs by their own
    // state they arrived as "running", so a run that had stopped claimed a
    // worker was still on it.
    expect(runStatusLabel("partial")).toBe("Finished, with gaps");
    expect(runStatusLabel("budget_stopped")).toBe("Stopped on budget");
  });
});

describe("RunsConsole", () => {
  it("shows the plain-language status on the run list, not the raw enum", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/runs") return jsonResponse({ runs: [succeededRun] });
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }));

    render(<RunsConsole />);

    expect(await screen.findByText("Finished")).toBeInTheDocument();
    expect(screen.queryByText("succeeded")).not.toBeInTheDocument();
  });

  it("lists a graph run no command launched, and opens that run", async () => {
    /*
     * Run 050b35e5 was readable at /solutions/lifecycle/run/... and absent
     * from /solutions/runs, because the list only knew graph runs a command
     * had launched. It is one row in this list now, and its one action goes
     * to the run itself rather than to the pipelines page.
     */
    const analysisRun = {
      id: "analysis:run-050b35e5",
      status: "partial",
      startedAt: "2026-08-25T08:31:01.000Z",
      completedAt: "2026-08-25T08:41:01.000Z",
      createdAt: "2026-08-25T08:31:01.000Z",
      durationMs: 600_000,
      risk: null,
      provider: "anthropic",
      model: null,
      branch: null,
      reviewStatus: "unreviewed",
      archivedAt: null,
      project: null,
      task: { id: "graph-1", title: "One request through all ten phases" },
      agent: { id: "graph-1", name: "Claude — analysis" },
      analysis: {
        graphId: "graph-1",
        graphRunId: "run-050b35e5",
        commandId: null,
        artifactCount: 2,
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/runs") {
        return jsonResponse({ runs: [], analysisRuns: [analysisRun] });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }));

    render(<RunsConsole />);

    expect(await screen.findByText("One request through all ten phases")).toBeInTheDocument();
    expect(screen.getByText("Finished, with gaps")).toBeInTheDocument();
    expect(screen.queryByText("A worker is on it")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View analysis" }))
      .toHaveAttribute("href", "/solutions/lifecycle/run/run-050b35e5");
  });

  it("says what a run spent, and says nothing when nothing was recorded", async () => {
    const base = {
      id: "analysis:run-1",
      status: "succeeded",
      startedAt: "2026-08-25T08:31:01.000Z",
      completedAt: "2026-08-25T08:41:01.000Z",
      createdAt: "2026-08-25T08:31:01.000Z",
      durationMs: 600_000,
      risk: null,
      provider: "anthropic",
      model: null,
      branch: null,
      reviewStatus: "unreviewed",
      archivedAt: null,
      project: null,
      task: { id: "graph-1", title: "A measured run" },
      agent: { id: "graph-1", name: "Claude — analysis" },
      analysis: {
        graphId: "graph-1",
        graphRunId: "run-1",
        commandId: null,
        artifactCount: 12,
        costMicros: 2_407_311,
        tokensUsed: 128_450,
        budgetAction: "PREFER_CHEAPER_MODEL",
      },
    };
    const unmeasured = {
      ...base,
      id: "analysis:run-2",
      task: { id: "graph-2", title: "An unmeasured run" },
      analysis: {
        graphId: "graph-2",
        graphRunId: "run-2",
        commandId: null,
        artifactCount: 0,
        costMicros: null,
        tokensUsed: null,
        budgetAction: null,
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/runs") {
        return jsonResponse({ runs: [], analysisRuns: [base, unmeasured] });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }));

    render(<RunsConsole />);

    expect(await screen.findByText(/\$2\.41/)).toBeInTheDocument();
    expect(screen.getByText(/128,450 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/Switched to a cheaper model/)).toBeInTheDocument();

    // The unmeasured run says nothing about cost rather than claiming $0.00.
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
    expect(screen.getByText(/An unmeasured run/)).toBeInTheDocument();
  });

  it("names the run the way the AI Factory names it", async () => {
    // The connection between the two surfaces is the id: the factory's
    // breadcrumb reads 050b35e5, so this row must too — not
    // "analysis:050b35e5-9eb6-4527-a10c-6a87b20f70a9".
    const analysisRun = {
      id: "analysis:050b35e5-9eb6-4527-a10c-6a87b20f70a9",
      status: "partial",
      startedAt: "2026-08-25T08:31:01.000Z",
      completedAt: "2026-08-25T08:41:01.000Z",
      createdAt: "2026-08-25T08:31:01.000Z",
      durationMs: 600_000,
      risk: null,
      provider: "anthropic",
      model: null,
      branch: null,
      reviewStatus: "unreviewed",
      archivedAt: null,
      project: null,
      task: { id: "graph-1", title: "One request through all ten phases" },
      agent: { id: "graph-1", name: "Claude — analysis" },
      analysis: {
        graphId: "graph-1",
        graphRunId: "050b35e5-9eb6-4527-a10c-6a87b20f70a9",
        commandId: null,
        artifactCount: 12,
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/runs") {
        return jsonResponse({ runs: [], analysisRuns: [analysisRun] });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }));

    render(<RunsConsole />);

    const label = await screen.findByText("050b35e5");
    expect(label).toBeInTheDocument();
    // The full id stays reachable for anyone quoting it, without being shouted.
    expect(label).toHaveAttribute("title", "050b35e5-9eb6-4527-a10c-6a87b20f70a9");
    expect(screen.queryByText(/^analysis:/)).not.toBeInTheDocument();
  });

  it("promotes the draft pull request to a primary action on the run detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runs") return jsonResponse({ runs: [succeededRun] });
      if (url === "/api/runs/run-1") {
        return jsonResponse({
          run: {
            ...succeededRun,
            pullRequest: {
              number: 7,
              title: "Canary documentation",
              state: "open",
              draft: true,
              url: "https://github.com/example/repository/pull/7",
            },
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    const user = userEvent.setup();

    render(<RunsConsole />);
    await user.click(await screen.findByRole("button", { name: "View run" }));

    const review = await screen.findByRole("link", { name: /review draft PR #7/i });
    expect(review).toHaveAttribute("href", "https://github.com/example/repository/pull/7");
    // The recorded enum stays one glance away for anyone who wants it.
    expect(screen.getByText("Recorded status")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
  });

  it("clears every finished run through the reason-carrying confirm, and reports what was kept", async () => {
    const clearPosts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/runs/clear-finished" && init?.method === "POST") {
        clearPosts.push(JSON.parse(String(init.body)));
        return jsonResponse({ deletedCount: 3, keptForEvidence: 1, keptForActivity: 0 });
      }
      if (url === "/api/runs") return jsonResponse({ runs: [succeededRun] });
      return jsonResponse({});
    }));
    const user = userEvent.setup();

    render(<RunsConsole />);

    await user.click(await screen.findByRole("button", { name: "Clear finished runs" }));
    // The confirm states the consequence before anything happens; nothing has
    // been posted yet, and the button holds until the reason is long enough.
    expect(clearPosts).toEqual([]);
    expect(screen.getByText(/queued and running work is untouched/i)).toBeInTheDocument();
    const confirm = screen.getAllByRole("button", { name: "Clear finished runs" }).at(-1)!;
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText("Why clear them?"), "Clearing history before the audit");
    await user.click(confirm);

    expect(clearPosts).toEqual([
      { reason: "Clearing history before the audit", detachEvidence: false },
    ]);
    expect(await screen.findByText(/3 runs cleared\. 1 kept because their work produced/)).toBeInTheDocument();
  });
});
