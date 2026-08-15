import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentsConsole } from "@/components/agents-console";
import { BacklogConsole } from "@/components/backlog-console";
import { ReportsConsole } from "@/components/reports-console";
import { RunsConsole } from "@/components/runs-console";

const id = "20000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Phase 1C control-plane consoles", () => {
  it("shows durable run timeline, validation, file, PR, and CI evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runs") return jsonResponse({ runs: [{
        id,
        status: "running",
        startedAt: "2026-08-13T12:00:00Z",
        completedAt: null,
        createdAt: "2026-08-13T12:00:00Z",
        durationMs: null,
        risk: "green",
        branch: "factory/20000000-mobile-fix",
        project: { id: "project", name: "SoftwareFactory" },
        task: { id: "task", title: "Fix mobile layout" },
        agent: { id: "agent", name: "Frontend" },
      }] });
      if (url === `/api/runs/${id}`) return jsonResponse({ run: {
        id,
        status: "running",
        risk: "green",
        createdAt: "2026-08-13T12:00:00Z",
        startedAt: "2026-08-13T12:00:00Z",
        completedAt: null,
        durationMs: null,
        project: { id: "project", name: "SoftwareFactory" },
        task: { id: "task", title: "Fix mobile layout" },
        agent: { id: "agent", name: "Frontend", role: "frontend" },
        provider: "openai",
        model: "codex",
        baseBranch: "main",
        baseSha: "abcdef012345",
        headBranch: "factory/20000000-mobile-fix",
        events: [{ id: "event", stage: "validation", status: "running", message: "Running checks", occurredAt: "2026-08-13T12:01:00Z" }],
        validations: [{ id: "validation", name: "typecheck", status: "passed", summary: "No errors" }],
        changedFiles: ["components/mobile.tsx"],
        commits: [{ sha: "1234567890", message: "Fix mobile layout", url: "https://github.com/example/repo/commit/123" }],
        pullRequest: { number: 12, draft: true, url: "https://github.com/example/repo/pull/12" },
        checks: [{ id: 1, name: "CI", status: "completed", conclusion: "success" }],
      } });
      throw new Error(`Unexpected fetch ${url}`);
    }));

    render(<RunsConsole />);
    await userEvent.click(await screen.findByRole("button", { name: "View run" }));

    expect(await screen.findByText("Running checks")).toBeInTheDocument();
    expect(screen.getByText("components/mobile.tsx")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #12" })).toBeInTheDocument();
    expect(screen.getByText("No errors")).toBeInTheDocument();
  });

  it("groups the runs list under the project that owns each run", async () => {
    const baseRun = {
      status: "succeeded",
      startedAt: "2026-08-13T12:00:00Z",
      completedAt: "2026-08-13T12:10:00Z",
      createdAt: "2026-08-13T12:00:00Z",
      durationMs: 600000,
      risk: "green",
      agent: { id: "agent", name: "Frontend" },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/runs") return jsonResponse({ runs: [
        { ...baseRun, id: "run-app-1", branch: "factory/app-1",
          project: { id: "project-app", name: "SoftwareFactory" },
          task: { id: "task-1", title: "Fix mobile layout" } },
        { ...baseRun, id: "run-gateway-1", branch: "factory/gateway-1",
          project: { id: "project-gateway", name: "Gateway" },
          task: { id: "task-2", title: "Harden webhook retries" } },
        { ...baseRun, id: "run-app-2", branch: "factory/app-2",
          project: { id: "project-app", name: "SoftwareFactory" },
          task: { id: "task-3", title: "Tighten empty states" } },
        { ...baseRun, id: "run-orphan", branch: "factory/orphan",
          project: null,
          task: { id: "task-4", title: "Unattributed maintenance" } },
      ] });
      throw new Error(`Unexpected fetch ${String(input)}`);
    }));

    render(<RunsConsole />);

    // One section per owning project, carrying its own honest count.
    const application = await screen.findByRole("region", { name: "Runs for SoftwareFactory" });
    expect(application).toHaveTextContent("2 runs");
    expect(application).toHaveTextContent("Fix mobile layout");
    expect(application).toHaveTextContent("Tighten empty states");

    const gateway = screen.getByRole("region", { name: "Runs for Gateway" });
    expect(gateway).toHaveTextContent("1 run");
    expect(gateway).toHaveTextContent("Harden webhook retries");

    // A run with no project in its bounded projection is grouped under an
    // honest label, not attributed to a project.
    const orphaned = screen.getByRole("region", { name: "Runs for Project unavailable" });
    expect(orphaned).toHaveTextContent("Unattributed maintenance");
  });

  it("offers a bounded retry only when run detail marks a terminal run retryable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/runs") return jsonResponse({ runs: [{
        id,
        status: "failed",
        startedAt: "2026-08-13T12:00:00Z",
        completedAt: "2026-08-13T12:01:00Z",
        createdAt: "2026-08-13T12:00:00Z",
        durationMs: 60_000,
        task: { id: "task", title: "Fix mobile layout" },
        agent: { id: "agent", name: "Frontend" },
      }] });
      if (url === `/api/runs/${id}/retry` && init?.method === "POST") {
        return jsonResponse({
          run: { id, status: "queued", attempt: 2 },
          message: "Retry queued within the run's bounded attempt limit.",
        }, 202);
      }
      if (url === `/api/runs/${id}`) return jsonResponse({ run: {
        id,
        status: "failed",
        retryable: true,
        createdAt: "2026-08-13T12:00:00Z",
        startedAt: "2026-08-13T12:00:00Z",
        completedAt: "2026-08-13T12:01:00Z",
        durationMs: 60_000,
        task: { id: "task", title: "Fix mobile layout" },
        agent: { id: "agent", name: "Frontend" },
      } });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RunsConsole />);
    await userEvent.click(await screen.findByRole("button", { name: "View run" }));
    await userEvent.click(await screen.findByRole("button", { name: "Retry run" }));

    expect(await screen.findByText("Retry queued within the run's bounded attempt limit.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/runs/${id}/retry`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows backlog acceptance criteria, dependencies, run, and PR linkage", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/tasks") return jsonResponse({ tasks: [{
        id,
        title: "Fix mobile layout",
        status: "in_progress",
        risk: "green",
        requiresOwnerApproval: false,
        priority: 90,
        createdAt: "2026-08-13T12:00:00Z",
        project: { id: "project", name: "SoftwareFactory" },
        agent: { id: "agent", name: "Frontend" },
      }] });
      if (url === `/api/tasks/${id}`) return jsonResponse({ task: {
        id,
        title: "Fix mobile layout",
        description: "Repair the narrow viewport.",
        status: "in_progress",
        risk: "green",
        requiresOwnerApproval: false,
        priority: 90,
        createdAt: "2026-08-13T12:00:00Z",
        project: { id: "project", name: "SoftwareFactory" },
        agent: { id: "agent", name: "Frontend" },
        command: { id: "command", prompt: "Fix mobile layout" },
        acceptanceCriteria: ["No horizontal scrolling"],
        dependencies: [{ id: "dependency", title: "Audit viewport", status: "completed" }],
        runs: [{ id: "run", status: "running", branch: "factory/run-mobile" }],
        pullRequests: [{ number: 12, draft: true, url: "https://github.com/example/repo/pull/12" }],
      } });
      throw new Error(`Unexpected fetch ${url}`);
    }));

    render(<BacklogConsole />);
    await userEvent.click(await screen.findByRole("button", { name: "Details" }));

    expect(await screen.findByText("No horizontal scrolling")).toBeInTheDocument();
    expect(screen.getByText("Audit viewport")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #12" })).toBeInTheDocument();
  });

  it("shows standard roster coverage and provider-neutral agent work", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/agents") return jsonResponse({ agents: [{
        id,
        name: "Factory Orchestrator",
        role: "orchestrator",
        description: "Plans work without owning a provider login.",
        status: "busy",
        provider: "openai",
        model: "codex",
        providerConnectionStatus: "Connected",
        currentAssignment: "Fix mobile layout",
        lastRunAt: "2026-08-13T12:00:00Z",
        capabilities: ["planning"],
      }] });
      if (url === `/api/agents/${id}`) return jsonResponse({ agent: {
        id,
        name: "Factory Orchestrator",
        role: "orchestrator",
        description: "Plans work without owning a provider login.",
        status: "busy",
        provider: "openai",
        model: "codex",
        providerConnectionStatus: "Connected",
        currentAssignment: "Fix mobile layout",
        lastRunAt: "2026-08-13T12:00:00Z",
        capabilities: ["planning"],
        responsibilities: ["Resolve the exact repository"],
        currentRuns: [{ id: "run", title: "Fix mobile layout", status: "running" }],
      } });
      throw new Error(`Unexpected fetch ${url}`);
    }));

    render(<AgentsConsole />);
    expect(await screen.findByText("Orchestrator · Defined")).toBeInTheDocument();
    expect(screen.getByText("Architect · Missing")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View agent" }));
    expect(await screen.findByText("Resolve the exact repository")).toBeInTheDocument();
  });

  it("renders structured report findings, decisions, runs, and PR evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/reports") return jsonResponse({ reports: [{
        id,
        type: "quality",
        status: "published",
        title: "Run quality report",
        summary: "Validated evidence",
        periodStart: null,
        periodEnd: null,
        publishedAt: "2026-08-13T12:05:00Z",
        createdAt: "2026-08-13T12:04:00Z",
        project: { id: "project", name: "SoftwareFactory" },
      }] });
      if (url === `/api/reports/${id}`) return jsonResponse({ report: {
        id,
        type: "quality",
        status: "published",
        title: "Run quality report",
        summary: "Validated evidence",
        periodStart: null,
        periodEnd: null,
        publishedAt: "2026-08-13T12:05:00Z",
        createdAt: "2026-08-13T12:04:00Z",
        project: { id: "project", name: "SoftwareFactory" },
        sections: [{ title: "Validation", items: ["Typecheck passed"] }],
        findings: [{ title: "No critical findings", severity: "green" }],
        decisions: [{ title: "Review draft PR", status: "pending", ownerAction: "Open PR #12" }],
        runs: [{ id: "run", title: "Fix mobile layout", status: "succeeded" }],
        pullRequests: [{ number: 12, draft: true, url: "https://github.com/example/repo/pull/12" }],
        changedFiles: ["components/mobile.tsx"],
        checks: [{ id: 1, name: "CI", status: "completed", conclusion: "success", url: "https://github.com/example/repo/actions/runs/1" }],
        validations: [{ name: "typecheck", status: "passed", durationMs: 20, attempt: 1, round: 1 }],
        security: { risk: "yellow", errorCode: null, blocker: null },
      } });
      throw new Error(`Unexpected fetch ${url}`);
    }));

    render(<ReportsConsole />);
    await userEvent.click(await screen.findByRole("button", { name: "Open report" }));

    expect(await screen.findByText("Typecheck passed")).toBeInTheDocument();
    expect(screen.getByText("No critical findings")).toBeInTheDocument();
    expect(screen.getByText("Open PR #12")).toBeInTheDocument();
    expect(screen.getByText("components/mobile.tsx")).toBeInTheDocument();
    expect(screen.getByText("typecheck")).toBeInTheDocument();
    expect(screen.getByText("CI")).toBeInTheDocument();
  });
});
