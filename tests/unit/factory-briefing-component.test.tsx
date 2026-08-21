import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FactoryBriefing } from "@/components/factory-briefing";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

type Overrides = Partial<Record<string, { body: unknown; status?: number }>>;

const SOURCE_URLS = [
  "/api/tasks?limit=100&view=briefing",
  "/api/runs?limit=100&view=briefing",
  "/api/graphs/runs?limit=100&view=briefing",
  "/api/agentos/inbox?limit=100&view=briefing",
  "/api/operations/overview?view=briefing",
  "/api/github/connections?view=briefing",
  "/api/agents?limit=100&view=briefing",
  "/api/worker/status",
] as const;

function stubSources(overrides: Overrides = {}) {
  const defaults: Record<string, unknown> = {
    "/api/tasks?limit=100&view=briefing": { tasks: [] },
    "/api/runs?limit=100&view=briefing": { runs: [] },
    "/api/graphs/runs?limit=100&view=briefing": { runs: [] },
    "/api/agentos/inbox?limit=100&view=briefing": { messages: [] },
    "/api/operations/overview?view=briefing": { incidents: [] },
    "/api/github/connections?view=briefing": { connections: [] },
    "/api/agents?limit=100&view=briefing": { agents: [] },
    "/api/worker/status": {
      worker: {
        connectionStatus: "connected",
        statusLabel: "Worker Connected",
        lastHeartbeatAt: "2026-08-21T12:00:00Z",
        activeWorkers: 1,
        availableWorkers: 1,
        staleAfterSeconds: 90,
      },
    },
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const override = overrides[url];
    if (override) return jsonResponse(override.body, override.status ?? 200);
    if (!(url in defaults)) throw new Error(`Unexpected request: ${url}`);
    return jsonResponse(defaults[url]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

describe("FactoryBriefing", () => {
  it("does not issue protected reads for a signed-out visitor", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<FactoryBriefing authenticated={false} />);

    expect(screen.getByRole("heading", { name: "Factory briefing" })).toBeInTheDocument();
    expect(screen.getByText(/Sign in to see live work/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("immediately hides a loaded tenant briefing when authentication is removed", async () => {
    stubSources({
      "/api/tasks?limit=100&view=briefing": {
        body: {
          tasks: [{
            id: "private-task",
            title: "Private tenant task",
            status: "queued",
            risk: "green",
            requiresOwnerApproval: false,
            priority: 50,
            createdAt: "2026-08-21T12:00:00Z",
            dependencyCount: 0,
            project: { id: "project-1", name: "Private workspace" },
            agent: null,
            latestRun: null,
            pullRequest: null,
          }],
        },
      },
    });
    const { rerender } = render(<FactoryBriefing authenticated />);

    expect(await screen.findByText("Private tenant task")).toBeInTheDocument();
    rerender(<FactoryBriefing authenticated={false} />);

    expect(screen.getByText(/Sign in to see live work/)).toBeInTheDocument();
    expect(screen.queryByText("Private tenant task")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Up next" })).not.toBeInTheDocument();
  });

  it("renders one truthful lane per lifecycle state without repeating inbox bodies or linked command prompts", async () => {
    const fetchMock = stubSources({
      "/api/tasks?limit=100&view=briefing": {
        body: {
          tasks: [
            {
              id: "approval", title: "Rotate checkout integration", status: "awaiting_approval",
              risk: "red", requiresOwnerApproval: true, priority: 100,
              createdAt: "2026-08-21T11:00:00Z", dependencyCount: 0,
              project: { id: "project-1", name: "Store" }, agent: null,
              command: { id: "linked-command", prompt: "PRIVATE LINKED PROMPT" }, latestRun: null, pullRequest: null,
            },
            {
              id: "active", title: "Build account settings", status: "in_progress",
              risk: "green", requiresOwnerApproval: false, priority: 70,
              createdAt: "2026-08-21T10:00:00Z", dependencyCount: 0,
              project: { id: "project-1", name: "Store" }, agent: { id: "frontend", name: "Frontend" },
              command: null, latestRun: null, pullRequest: null,
            },
            {
              id: "done", title: "Add health evidence", status: "completed",
              risk: "green", requiresOwnerApproval: false, priority: 50,
              createdAt: "2026-08-21T09:00:00Z", dependencyCount: 0,
              project: { id: "project-1", name: "Store" }, agent: null,
              command: null, latestRun: null,
              pullRequest: { number: 88, url: "https://github.com/acme/store/pull/88", status: "draft" },
            },
            {
              id: "queued", title: "Polish onboarding", status: "queued",
              risk: "yellow", requiresOwnerApproval: false, priority: 40,
              createdAt: "2026-08-21T08:00:00Z", dependencyCount: 1,
              project: { id: "project-1", name: "Store" }, agent: null,
              command: null, latestRun: null, pullRequest: null,
            },
          ],
        },
      },
      "/api/agentos/inbox?limit=100&view=briefing": {
        body: {
          messages: [{
            id: "question", status: "open", kind: "multiple_choice", agentName: "Architect",
            createdAt: "2026-08-21T12:00:00Z", body: "PRIVATE QUESTION BODY",
          }],
        },
      },
      "/api/agents?limit=100&view=briefing": {
        body: {
          agents: [{
            id: "orchestrator", name: "Orchestrator", role: "orchestrator",
            status: "busy",
          }],
        },
      },
    });

    render(<FactoryBriefing authenticated />);

    expect(await screen.findByRole("heading", { name: "Factory briefing" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Needs owner now" })).toHaveTextContent("Rotate checkout integration");
    expect(screen.getByRole("region", { name: "Needs owner now" })).toHaveTextContent("Decision requested by Architect");
    expect(screen.getByRole("region", { name: "Underway" })).toHaveTextContent("Build account settings");
    expect(screen.getByRole("region", { name: "Recently finished" })).toHaveTextContent("Add health evidence");
    expect(screen.getByRole("region", { name: "Up next" })).toHaveTextContent("Polish onboarding");
    expect(screen.getByText("PR #88").closest("a")).toHaveAttribute("href", "https://github.com/acme/store/pull/88");
    expect(screen.getByText("Coordinator role: Orchestrator")).toBeInTheDocument();
    expect(screen.getByText("1 busy · 1 rostered")).toBeInTheDocument();
    expect(screen.getByLabelText("Crew status")).toHaveTextContent("Phase 1C · Worker Connected");
    expect(screen.queryByText("PRIVATE QUESTION BODY")).not.toBeInTheDocument();
    expect(screen.queryByText("PRIVATE LINKED PROMPT")).not.toBeInTheDocument();
    expect(screen.queryByText(/Needs you now/)).not.toBeInTheDocument();
    expect(screen.queryByText(/your decision/i)).not.toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/commands"), expect.anything());
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ cache: "no-store" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init).not.toHaveProperty("method");
    }
  });

  it("makes partial source failure explicit and never renders a false all-clear", async () => {
    stubSources({
      "/api/graphs/runs?limit=100&view=briefing": {
        body: { error: { message: "Graph store unavailable." } },
        status: 503,
      },
    });

    render(<FactoryBriefing authenticated />);

    expect(await screen.findByRole("status")).toHaveTextContent(/Briefing incomplete\. Unavailable: .*Graph runs/);
    expect(screen.getAllByText("No items are visible in the sources that loaded.")).toHaveLength(4);
    expect(screen.queryByText(/Nothing in the live window needs an owner decision/)).not.toBeInTheDocument();
  });

  it("treats a malformed successful projection as unavailable rather than empty", async () => {
    stubSources({
      "/api/tasks?limit=100&view=briefing": {
        body: { tasks: [{ id: "missing-lifecycle-fields" }] },
      },
    });

    render(<FactoryBriefing authenticated />);

    expect(await screen.findByRole("status")).toHaveTextContent(/Briefing incomplete\. Unavailable: .*Backlog/);
    expect(screen.getByRole("region", { name: "Up next" }))
      .toHaveTextContent("No items are visible in the sources that loaded.");
  });

  it("treats an expired protected session as signed out even if another source answers", async () => {
    const fetchMock = stubSources({
      "/api/agentos/inbox?limit=100&view=briefing": {
        body: { error: { message: "Sign in required." } },
        status: 401,
      },
    });

    render(<FactoryBriefing authenticated />);

    expect(await screen.findByText(/Sign in to see live work/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Needs owner now" })).not.toBeInTheDocument();
  });

  it("marks a saturated source incomplete instead of presenting an empty window as all-clear", async () => {
    const cancelledTasks = Array.from({ length: 100 }, (_, index) => ({
      id: `cancelled-${index}`,
      title: `Cancelled task ${index}`,
      status: "cancelled",
      risk: "green",
      requiresOwnerApproval: false,
      priority: 50,
      createdAt: "2026-08-21T12:00:00Z",
      dependencyCount: 0,
      project: { id: "project-1", name: "Store" },
      agent: null,
      command: null,
      latestRun: null,
      pullRequest: null,
    }));
    stubSources({
      "/api/tasks?limit=100&view=briefing": { body: { tasks: cancelledTasks } },
    });

    render(<FactoryBriefing authenticated />);

    expect(await screen.findByRole("status")).toHaveTextContent(/Briefing incomplete.*Backlog/);
    expect(screen.getAllByText("No items are visible in the sources that loaded.")).toHaveLength(4);
    expect(screen.queryByText(/Nothing in the live window needs an owner decision/)).not.toBeInTheDocument();
  });

  it("aborts a hung source at its deadline and reports that source as unavailable", async () => {
    vi.useFakeTimers();
    const fetchMock = stubSources();
    const regularFetch = fetchMock.getMockImplementation();
    const aborted = vi.fn();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/graphs/runs?limit=100&view=briefing") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted();
            reject(new DOMException("The request was aborted.", "AbortError"));
          }, { once: true });
        });
      }
      if (!regularFetch) throw new Error("The regular source implementation is unavailable.");
      return regularFetch(input, init);
    });

    render(<FactoryBriefing authenticated />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(aborted).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(aborted).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent(/Briefing incomplete\. Unavailable: .*Graph runs/);
  });

  it("announces an all-source failure and disables retry while the next read is pending", async () => {
    const unavailable = Object.fromEntries(
      SOURCE_URLS.map((url) => [url, { body: { error: { message: "Unavailable." } }, status: 503 }]),
    ) as Overrides;
    const fetchMock = stubSources(unavailable);

    render(<FactoryBriefing authenticated />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not read any live control-plane source/i);
    const retry = screen.getByRole("button", { name: /try again/i });

    const pending: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    fireEvent.click(retry);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(16));
    expect(screen.getByRole("button", { name: /retrying/i })).toBeDisabled();

    for (const resolve of pending) {
      resolve(jsonResponse({ error: { message: "Unavailable." } }, 503));
    }
    await waitFor(() => expect(screen.getByRole("button", { name: /try again/i })).not.toBeDisabled());
  });
});
