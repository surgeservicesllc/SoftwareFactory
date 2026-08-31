import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GrokWorkspace } from "@/components/grok/grok-workspace";
import type { GrokSession, GrokSessionCursor, GrokSessionDetail } from "@/lib/grok/contracts";

const PROJECT = { id: "11111111-1111-4111-8111-111111111111", name: "Software Factory" };
const SESSION: GrokSessionDetail = {
  session: {
    id: "22222222-2222-4222-8222-222222222222",
    projectId: PROJECT.id,
    projectName: PROJECT.name,
    title: "Repair checkout",
    goal: "Fix the checkout failure and prove it with tests.",
    status: "running",
    commandId: null,
    graphId: "33333333-3333-4333-8333-333333333333",
    graphRunId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-08-30T12:00:00.000Z",
    updatedAt: "2026-08-30T12:01:00.000Z",
    allowedActions: ["pause"],
  },
  messages: [
    { id: "m1", role: "user", content: "Fix checkout", createdAt: "2026-08-30T12:00:00.000Z" },
    { id: "m2", role: "assistant", content: "I recorded the plan.", createdAt: "2026-08-30T12:00:01.000Z" },
    { id: "m3", role: "tool", content: "CI evidence was recorded.", createdAt: "2026-08-30T12:00:02.000Z" },
  ],
  tasks: [
    { id: "t1", taskKey: "research", title: "Inspect checkout", status: "completed", provider: "anthropic", model: "claude-sonnet", agentName: null, attempt: 1, dependsOn: [] },
    { id: "t2", taskKey: "implement", title: "Apply the repair", status: "running", provider: "openai", model: "gpt-codex", agentName: null, attempt: 2, dependsOn: ["research"] },
  ],
  events: [{ id: "e1", type: "session.started", detail: "Planning began.", createdAt: "2026-08-30T12:00:04.000Z" }],
  artifacts: [{ id: "a1", kind: "test_run", label: "Focused tests", uri: null, createdAt: "2026-08-30T12:00:03.000Z" }],
  runEvidence: {
    state: "RUNNING",
    closureNote: null,
    startedAt: "2026-08-30T12:00:01.000Z",
    completedAt: null,
    tokensUsed: 12_345,
    costMicros: 456_700,
    progress: { completed: 1, total: 2, percent: 50 },
    events: [{ id: "ge1", type: "node.completed", detail: "Repository inspection completed.", nodeKey: "research", createdAt: "2026-08-30T12:00:02.000Z" }],
    eventsTruncated: false,
    release: {
      pullRequest: { url: "https://github.com/example/factory/pull/42", number: 42, repository: "example/factory" },
      producedCommit: "a".repeat(40),
      baseBranch: "main",
      checks: [{ name: "unit / linux", conclusion: "success", url: "https://github.com/example/factory/actions/runs/9" }],
      deployment: { environment: "production", state: "success", url: "https://preview.example.dev" },
      health: { url: "https://preview.example.dev/health", healthy: true, postDeployValidation: "availability probe passed" },
    },
  },
};

const BLOCKED_SESSION: GrokSessionDetail = {
  ...SESSION,
  session: {
    ...SESSION.session,
    status: "blocked",
    graphId: null,
    graphRunId: null,
    allowedActions: [],
  },
  tasks: SESSION.tasks.map((task) => ({
    ...task,
    status: "pending_graph",
    agentName: task.provider === "anthropic" ? "Claude reviewer" : "Codex builder",
  })),
};

const UNPLANNED_SESSION: GrokSessionDetail = {
  ...SESSION,
  session: {
    ...SESSION.session,
    title: "Fix checkout",
    goal: "Fix checkout",
    status: "blocked",
    graphId: null,
    graphRunId: null,
    allowedActions: [],
  },
  messages: [SESSION.messages[0]!],
  tasks: [],
  events: [],
  artifacts: [],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installFetch(
  detail: GrokSessionDetail | null = null,
  options: Readonly<{
    includeDetailInList?: boolean;
    detailFailures?: number;
    detailPending?: boolean;
    planningFailure?: Readonly<{ message: string; sessionId: string }>;
    postFailures?: number;
    postHttpFailures?: number;
    controlBodyFailures?: number;
    controlHttpFailures?: number;
    historyCursor?: GrokSessionCursor;
    olderSessions?: readonly GrokSession[];
  }> = {},
) {
  let remainingDetailFailures = options.detailFailures ?? 0;
  let remainingPostFailures = options.postFailures ?? 0;
  let remainingPostHttpFailures = options.postHttpFailures ?? 0;
  let remainingControlBodyFailures = options.controlBodyFailures ?? 0;
  let remainingControlHttpFailures = options.controlHttpFailures ?? 0;
  let controlFailureOccurred = false;
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/projects") return json({ projects: [PROJECT] });
    if (url === "/api/grok/sessions" && init?.method === "POST") {
      if (remainingPostFailures > 0) {
        remainingPostFailures -= 1;
        throw new TypeError("The network connection was interrupted.");
      }
      if (remainingPostHttpFailures > 0) {
        remainingPostHttpFailures -= 1;
        return json({ error: { message: "The server could not project the durable attempt." } }, 503);
      }
      if (options.planningFailure) {
        return json({
          sessionId: options.planningFailure.sessionId,
          error: {
            code: "MISSING_CODEX_AGENT",
            message: options.planningFailure.message,
          },
        }, 409);
      }
      return json({
        ...BLOCKED_SESSION,
        workerWoken: false,
        executionStarted: false,
        blocked: {
          code: "execution_bridge_not_connected",
          message: "The exact provider, model, and agent execution bridge is not connected. The plan is saved; no graph or worker was launched.",
        },
      }, 202);
    }
    if (url.startsWith("/api/grok/sessions?") && !init?.method) {
      const isOlderPage = url.includes("beforeCreatedAt=");
      return json({
        sessions: isOlderPage
          ? options.olderSessions ?? []
          : detail && options.includeDetailInList !== false ? [detail.session] : [],
        nextCursor: isOlderPage ? null : options.historyCursor ?? null,
      });
    }
    if (url.endsWith("/control") && init?.method === "POST") {
      const action = JSON.parse(String(init.body)).action as "pause" | "resume";
      if (remainingControlBodyFailures > 0) {
        remainingControlBodyFailures -= 1;
        controlFailureOccurred = true;
        return new Response("{", { status: 200, headers: { "content-type": "application/json" } });
      }
      if (remainingControlHttpFailures > 0) {
        remainingControlHttpFailures -= 1;
        controlFailureOccurred = true;
        return json({ error: { message: "The server lost the response after the durable control attempt." } }, 500);
      }
      const source = detail ?? SESSION;
      const resumed = action === "resume";
      return json({
        ...source,
        session: {
          ...source.session,
          status: resumed ? "planned" : "paused",
          allowedActions: resumed ? ["pause", "stop"] : ["resume", "stop"],
        },
        control: { intentId: "control-1", action, state: "applied" },
        replayed: resumed && controlFailureOccurred,
        workerWoken: resumed,
        note: resumed
          ? "The resume was already applied and the exact graph worker wake was accepted again for recovery."
          : "The control was durably applied by the existing audited runtime boundary.",
      });
    }
    if (url.includes("/api/grok/sessions/")) {
      if (options.detailPending) return new Promise<Response>(() => undefined);
      if (remainingDetailFailures > 0) {
        remainingDetailFailures -= 1;
        return json({ error: { message: "The durable planning record could not be reloaded." } }, 503);
      }
      return json(detail ?? SESSION);
    }
    return json({ error: { message: "unexpected request" } }, 500);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("GrokWorkspace", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/solutions/factory/grok");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is a first-class Factory destination and never invents a session", async () => {
    installFetch();
    render(<GrokWorkspace initialSelection={{}} viewer={{ email: "owner@example.com" }} />);

    expect(await screen.findByRole("heading", { name: "Ask for the outcome" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Grok Bot" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("No persisted sessions for this project.")).toBeInTheDocument();
    expect(screen.getByText("No goal recorded")).toBeInTheDocument();
  });

  it("loads project-scoped session history through an exact keyset cursor", async () => {
    const user = userEvent.setup();
    const olderSession: GrokSession = {
      ...SESSION.session,
      id: "22222222-2222-4222-8222-222222222223",
      title: "Older repair",
      createdAt: "2026-08-29T12:00:00.000Z",
      updatedAt: "2026-08-29T12:01:00.000Z",
    };
    const historyCursor = {
      createdAt: SESSION.session.createdAt,
      id: SESSION.session.id,
    };
    const fetchMock = installFetch(SESSION, { historyCursor, olderSessions: [olderSession] });
    render(<GrokWorkspace initialSelection={{ projectId: PROJECT.id }} />);

    const loadOlder = await screen.findByRole("button", { name: "Load older sessions" });
    await user.click(loadOlder);

    expect(await screen.findByText(olderSession.title)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/grok/sessions?projectId=${PROJECT.id}&limit=20`
      + `&beforeCreatedAt=${encodeURIComponent(historyCursor.createdAt)}`
      + `&beforeId=${historyCursor.id}`,
      { cache: "no-store" },
    );
  });

  it("renders only persisted messages, task assignments, events, and evidence", async () => {
    installFetch(SESSION);
    render(<GrokWorkspace initialSelection={{ sessionId: SESSION.session.id }} />);

    expect(await screen.findByText("I recorded the plan.")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Recorded tool evidence message" })).toHaveTextContent(
      "CI evidence was recorded.",
    );
    const controlCenter = screen.getByRole("complementary", { name: "Session inspector" });
    expect(within(controlCenter).getByRole("button", { name: "pause session" })).toBeEnabled();
    expect(within(controlCenter).queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
    expect(within(controlCenter).queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(within(controlCenter).queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(within(controlCenter).getByRole("button", { name: "resume unavailable in running" })).toBeDisabled();

    await userEvent.click(within(controlCenter).getByRole("tab", { name: "Plan" }));
    expect(within(controlCenter).getByText("Inspect checkout")).toBeInTheDocument();
    expect(within(controlCenter).getByText(/after research/)).toBeInTheDocument();

    await userEvent.click(within(controlCenter).getByRole("tab", { name: "Agents" }));
    expect(within(controlCenter).getByText("Observed node execution route")).toBeInTheDocument();
    expect(within(controlCenter).getByText(/no bot account or worker-process identity was recorded/i)).toBeInTheDocument();
    expect(within(controlCenter).getByText(/attempt 2/)).toBeInTheDocument();

    await userEvent.click(within(controlCenter).getByRole("tab", { name: "Progress" }));
    expect(within(controlCenter).getByText("1 of 2 nodes complete")).toBeInTheDocument();
    expect(within(controlCenter).getByText("12,345")).toBeInTheDocument();
    expect(within(controlCenter).getByText("$0.4567")).toBeInTheDocument();
    expect(within(controlCenter).getByText(/node.completed · research/)).toBeInTheDocument();
    const progressItems = within(controlCenter).getAllByRole("listitem");
    expect(progressItems[0]).toHaveTextContent("node.completed · research");
    expect(progressItems[1]).toHaveTextContent("session.started");

    await userEvent.click(within(controlCenter).getByRole("tab", { name: "Tests" }));
    expect(within(controlCenter).getByRole("link", { name: "unit / linux" })).toHaveAttribute(
      "href", "https://github.com/example/factory/actions/runs/9",
    );

    await userEvent.click(within(controlCenter).getByRole("tab", { name: "Files / Diffs" }));
    expect(within(controlCenter).getByRole("link", { name: "Open files and diffs" })).toHaveAttribute(
      "href", "https://github.com/example/factory/pull/42/files",
    );

    await userEvent.click(within(controlCenter).getByRole("tab", { name: "Preview" }));
    expect(within(controlCenter).getByRole("link", { name: "https://preview.example.dev" })).toBeInTheDocument();

    await userEvent.click(within(controlCenter).getByRole("tab", { name: "Deployment" }));
    expect(within(controlCenter).getByText("production · success")).toBeInTheDocument();
    expect(within(controlCenter).getByText("availability probe passed")).toBeInTheDocument();
    expect(within(controlCenter).getByText("Rollback")).toBeInTheDocument();
    expect(within(controlCenter).getByText("Automatic continuation")).toBeInTheDocument();
    expect(within(controlCenter).getAllByText("Not Connected")).toHaveLength(2);
  });

  it("keeps one evidence tab in the keyboard order and supports arrow, Home, and End navigation", async () => {
    installFetch(BLOCKED_SESSION);
    const user = userEvent.setup();
    render(<GrokWorkspace initialSelection={{ sessionId: BLOCKED_SESSION.session.id }} />);

    const inspector = await screen.findByRole("complementary", { name: "Session inspector" });
    const goal = within(inspector).getByRole("tab", { name: "Goal" });
    const plan = within(inspector).getByRole("tab", { name: "Plan" });
    const deployment = within(inspector).getByRole("tab", { name: "Deployment" });
    const panel = within(inspector).getByRole("tabpanel");

    expect(goal).toHaveAttribute("tabindex", "0");
    expect(plan).toHaveAttribute("tabindex", "-1");
    expect(panel).toHaveAttribute("tabindex", "0");
    goal.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(plan).toHaveFocus());
    expect(plan).toHaveAttribute("aria-selected", "true");
    expect(goal).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{End}");
    await waitFor(() => expect(deployment).toHaveFocus());
    expect(deployment).toHaveAttribute("aria-selected", "true");
    expect(within(inspector).getAllByText("Not Connected")).toHaveLength(2);

    await user.keyboard("{Home}");
    await waitFor(() => expect(goal).toHaveFocus());
    expect(goal).toHaveAttribute("aria-selected", "true");
  });

  it("renders a 202 durable-but-blocked plan without implying execution", async () => {
    const fetchMock = installFetch();
    const user = userEvent.setup();
    render(<GrokWorkspace initialSelection={{}} />);
    await screen.findByRole("heading", { name: "Ask for the outcome" });

    await user.type(screen.getByRole("textbox", { name: "Tell Grok Bot what you want done" }), "Fix checkout");
    await user.click(screen.getByRole("button", { name: "Start goal" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/grok/sessions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringMatching(new RegExp(
          `^\\{"projectId":"${PROJECT.id}","prompt":"Fix checkout","idempotencyKey":"grok-submit:[^"]+"\\}$`,
        )),
      }),
    ));
    expect(await screen.findByText("I recorded the plan.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "The exact provider, model, and agent execution bridge is not connected. The plan is saved; no graph or worker was launched.",
    );
    expect(screen.getByText("Durable session · plan saved; execution not linked")).toBeInTheDocument();
    expect(screen.getAllByText("blocked").length).toBeGreaterThan(0);
    expect(window.location.search).toContain(`sessionId=${SESSION.session.id}`);
  });

  it("truthfully labels a truncated Grok session-event tail", async () => {
    installFetch({ ...SESSION, eventsTruncated: true });
    render(<GrokWorkspace initialSelection={{ sessionId: SESSION.session.id }} />);

    const inspector = await screen.findByRole("complementary", { name: "Session inspector" });
    await userEvent.click(within(inspector).getByRole("tab", { name: "Progress" }));
    expect(within(inspector).getByText("Newest 200 Grok session events shown.")).toBeInTheDocument();
  });

  it("reopens a durable request when planning returns 409 without claiming a plan exists", async () => {
    const planningMessage = "No ready configured Codex agent can cover the repository-writing task.";
    const fetchMock = installFetch(UNPLANNED_SESSION, {
      includeDetailInList: false,
      planningFailure: { message: planningMessage, sessionId: UNPLANNED_SESSION.session.id },
    });
    const user = userEvent.setup();
    render(<GrokWorkspace initialSelection={{}} />);
    await screen.findByRole("heading", { name: "Ask for the outcome" });

    await user.type(screen.getByRole("textbox", { name: "Tell Grok Bot what you want done" }), "Fix checkout");
    await user.click(screen.getByRole("button", { name: "Start goal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(planningMessage);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/grok/sessions/${UNPLANNED_SESSION.session.id}`,
      { cache: "no-store" },
    );
    expect(screen.getByText("The request is saved, but no plan was recorded. No graph, worker, or provider started.")).toBeInTheDocument();
    expect(screen.getAllByText(/request saved; no plan recorded/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/plan saved; execution not linked/i)).not.toBeInTheDocument();
    expect(window.location.search).toContain(`sessionId=${UNPLANNED_SESSION.session.id}`);

    const inspector = screen.getByRole("complementary", { name: "Session inspector" });
    await user.click(within(inspector).getByRole("tab", { name: "Agents" }));
    expect(within(inspector).getByText("No routing plan recorded")).toBeInTheDocument();
    expect(within(inspector).getByText(/no provider, model, or agent routing identity was recorded/i)).toBeInTheDocument();
  });

  it("keeps a committed planning-failure session in the URL when its follow-up read fails", async () => {
    const planningMessage = "Planning is blocked until a Ready configured Codex agent covers the repository-writing task.";
    installFetch(UNPLANNED_SESSION, {
      detailFailures: 1,
      includeDetailInList: false,
      planningFailure: { message: planningMessage, sessionId: UNPLANNED_SESSION.session.id },
    });
    const user = userEvent.setup();
    render(<GrokWorkspace initialSelection={{}} />);
    await screen.findByRole("heading", { name: "Ask for the outcome" });

    await user.type(screen.getByRole("textbox", { name: "Tell Grok Bot what you want done" }), "Fix checkout");
    await user.click(screen.getByRole("button", { name: "Start goal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(planningMessage);
    expect(window.location.search).toContain(`projectId=${PROJECT.id}`);
    expect(window.location.search).toContain(`sessionId=${UNPLANNED_SESSION.session.id}`);
  });

  it("restores a deep-linked session even when it is outside the first list page", async () => {
    const fetchMock = installFetch(BLOCKED_SESSION, { includeDetailInList: false });
    render(<GrokWorkspace initialSelection={{ sessionId: BLOCKED_SESSION.session.id }} />);

    expect(await screen.findByText("I recorded the plan.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/grok/sessions/${BLOCKED_SESSION.session.id}`,
      { cache: "no-store" },
    );
    expect(window.location.search).toContain(`projectId=${PROJECT.id}`);
    expect(window.location.search).toContain(`sessionId=${BLOCKED_SESSION.session.id}`);
  });

  it("does not claim a saved plan while recorded session detail is still loading", async () => {
    installFetch(UNPLANNED_SESSION, { detailPending: true });
    render(<GrokWorkspace initialSelection={{ sessionId: UNPLANNED_SESSION.session.id }} />);

    expect(await screen.findByText("Durable session · loading recorded evidence")).toBeInTheDocument();
    expect(screen.queryByText(/plan saved; execution not linked/i)).not.toBeInTheDocument();
  });

  it("reuses the create idempotency key after an uncertain network failure", async () => {
    const fetchMock = installFetch(null, { postFailures: 1 });
    const user = userEvent.setup();
    render(<GrokWorkspace initialSelection={{}} />);
    await screen.findByRole("heading", { name: "Ask for the outcome" });

    const prompt = screen.getByRole("textbox", { name: "Tell Grok Bot what you want done" });
    await user.type(prompt, "Fix checkout");
    await user.click(screen.getByRole("button", { name: "Start goal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("network connection");
    await user.click(screen.getByRole("button", { name: "Start goal" }));
    expect(await screen.findByText("I recorded the plan.")).toBeInTheDocument();

    const bodies = fetchMock.mock.calls
      .filter(([url, init]) => String(url) === "/api/grok/sessions" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as { idempotencyKey: string });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);
  });

  it("reuses the create idempotency key after an indeterminate HTTP 503", async () => {
    const fetchMock = installFetch(null, { postHttpFailures: 1 });
    const user = userEvent.setup();
    render(<GrokWorkspace initialSelection={{}} />);
    await screen.findByRole("heading", { name: "Ask for the outcome" });

    const prompt = screen.getByRole("textbox", { name: "Tell Grok Bot what you want done" });
    await user.type(prompt, "Fix checkout");
    await user.click(screen.getByRole("button", { name: "Start goal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "server could not project the durable attempt",
    );
    await user.click(screen.getByRole("button", { name: "Start goal" }));
    expect(await screen.findByText("I recorded the plan.")).toBeInTheDocument();

    const bodies = fetchMock.mock.calls
      .filter(([url, init]) => String(url) === "/api/grok/sessions" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as { idempotencyKey: string });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);
  });

  it("does not turn an unsafe durable artifact reference into a link", async () => {
    installFetch({
      ...SESSION,
      artifacts: [{
        id: "unsafe-artifact",
        kind: "report",
        label: "Unsafe report",
        uri: "javascript:alert(document.domain)",
        createdAt: "2026-08-30T12:00:03.000Z",
      }],
    });
    render(<GrokWorkspace initialSelection={{ sessionId: SESSION.session.id }} />);
    const inspector = await screen.findByRole("complementary", { name: "Session inspector" });
    await userEvent.click(within(inspector).getByRole("tab", { name: "Artifacts" }));
    expect(within(inspector).getByText("Unsafe report")).toBeInTheDocument();
    expect(within(inspector).queryByRole("link", { name: "Open Unsafe report" })).not.toBeInTheDocument();
  });

  it("restores a durable blocked session truthfully after reload", async () => {
    installFetch(BLOCKED_SESSION);
    render(<GrokWorkspace initialSelection={{ sessionId: BLOCKED_SESSION.session.id }} />);

    expect(await screen.findByText("The session and plan are saved, but no graph or worker execution has started.")).toBeInTheDocument();
    const inspector = screen.getByRole("complementary", { name: "Session inspector" });
    expect(within(inspector).queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(within(inspector).queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    await userEvent.click(within(inspector).getByRole("tab", { name: "Agents" }));
    expect(within(inspector).getByText("Planned routing intent")).toBeInTheDocument();
    expect(within(inspector).getByText(/do not prove execution/i)).toBeInTheDocument();
  });

  it("records a control intent through the session boundary and reloads durable state", async () => {
    const fetchMock = installFetch(SESSION);
    const user = userEvent.setup();
    render(<GrokWorkspace initialSelection={{ sessionId: SESSION.session.id }} />);

    const inspector = await screen.findByRole("complementary", { name: "Session inspector" });
    await user.click(within(inspector).getByRole("button", { name: "pause session" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/grok/sessions/${SESSION.session.id}/control`,
      expect.objectContaining({ method: "POST" }),
    ));
    expect(within(inspector).getByRole("button", { name: "resume session" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("durably applied");
  });

  it("reuses the exact Resume key after an indeterminate 500 and recovers the wake", async () => {
    const pausedSession: GrokSessionDetail = {
      ...SESSION,
      session: {
        ...SESSION.session,
        status: "paused",
        allowedActions: ["resume", "stop"],
      },
    };
    const fetchMock = installFetch(pausedSession, { controlHttpFailures: 1 });
    const user = userEvent.setup();
    render(<GrokWorkspace initialSelection={{ sessionId: pausedSession.session.id }} />);

    const inspector = await screen.findByRole("complementary", { name: "Session inspector" });
    await user.click(within(inspector).getByRole("button", { name: "resume session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "server lost the response after the durable control attempt",
    );
    await user.click(within(inspector).getByRole("button", { name: "resume session" }));
    expect(await screen.findByRole("status")).toHaveTextContent("accepted again for recovery");

    const bodies = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/control") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as {
        action: string; idempotencyKey: string;
      });
    expect(bodies).toHaveLength(2);
    expect(bodies.map((body) => body.action)).toEqual(["resume", "resume"]);
    expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);
  });

  it("reuses the exact Resume key after a successful response body cannot be read", async () => {
    const pausedSession: GrokSessionDetail = {
      ...SESSION,
      session: {
        ...SESSION.session,
        status: "paused",
        allowedActions: ["resume", "stop"],
      },
    };
    const fetchMock = installFetch(pausedSession, { controlBodyFailures: 1 });
    const user = userEvent.setup();
    render(<GrokWorkspace initialSelection={{ sessionId: pausedSession.session.id }} />);

    const inspector = await screen.findByRole("complementary", { name: "Session inspector" });
    await user.click(within(inspector).getByRole("button", { name: "resume session" }));
    await screen.findByRole("alert");
    await user.click(within(inspector).getByRole("button", { name: "resume session" }));
    expect(await screen.findByRole("status")).toHaveTextContent("accepted again for recovery");

    const bodies = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/control") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as { idempotencyKey: string });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);
  });

  it("never advertises Cancel or Retry even when a stale payload lists them", async () => {
    installFetch({
      ...SESSION,
      session: { ...SESSION.session, allowedActions: ["pause", "cancel", "retry"] },
    });
    render(<GrokWorkspace initialSelection={{ sessionId: SESSION.session.id }} />);

    const inspector = await screen.findByRole("complementary", { name: "Session inspector" });
    expect(within(inspector).queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(within(inspector).queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(within(inspector).getByRole("button", { name: "pause session" })).toBeEnabled();
  });
});
