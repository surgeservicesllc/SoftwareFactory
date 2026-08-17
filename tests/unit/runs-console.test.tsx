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
