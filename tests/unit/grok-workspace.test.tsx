import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GrokWorkspace } from "@/components/grok/grok-workspace";
import type { GrokSessionDetail } from "@/lib/grok/contracts";

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
    allowedActions: ["pause", "cancel"],
  },
  messages: [
    { id: "m1", role: "user", content: "Fix checkout", createdAt: "2026-08-30T12:00:00.000Z" },
    { id: "m2", role: "assistant", content: "I recorded the plan.", createdAt: "2026-08-30T12:00:01.000Z" },
    { id: "m3", role: "tool", content: "CI evidence was recorded.", createdAt: "2026-08-30T12:00:02.000Z" },
  ],
  tasks: [
    { id: "t1", taskKey: "research", title: "Inspect checkout", status: "running", provider: "anthropic", model: "claude-sonnet", agentName: null, dependsOn: [] },
    { id: "t2", taskKey: "implement", title: "Apply the repair", status: "pending", provider: "openai", model: "gpt-codex", agentName: null, dependsOn: ["research"] },
  ],
  events: [{ id: "e1", type: "session.started", detail: "Planning began.", createdAt: "2026-08-30T12:00:02.000Z" }],
  artifacts: [{ id: "a1", kind: "test_run", label: "Focused tests", uri: null, createdAt: "2026-08-30T12:00:03.000Z" }],
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installFetch(detail: GrokSessionDetail | null = null) {
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/projects") return json({ projects: [PROJECT] });
    if (url === "/api/grok/sessions" && init?.method === "POST") return json({
      ...BLOCKED_SESSION,
      workerWoken: false,
      executionStarted: false,
      blocked: {
        code: "execution_bridge_not_connected",
        message: "The exact provider, model, and agent execution bridge is not connected. The plan is saved; no graph or worker was launched.",
      },
    }, 202);
    if (url === "/api/grok/sessions") return json({ sessions: detail ? [detail.session] : [] });
    if (url.endsWith("/control") && init?.method === "POST") {
      const action = JSON.parse(String(init.body)).action as "pause" | "cancel";
      const cancelled = action === "cancel";
      return json({
        ...SESSION,
        session: {
          ...SESSION.session,
          status: cancelled ? "cancelled" : "paused",
          allowedActions: cancelled ? [] : ["resume", "stop"],
        },
        control: { intentId: "control-1", action, state: "applied" },
        replayed: false,
        workerWoken: false,
        note: cancelled
          ? "Cancellation was recorded at the safe runtime boundary."
          : "The control was durably applied by the existing audited runtime boundary.",
      });
    }
    if (url.includes("/api/grok/sessions/")) return json(detail ?? SESSION);
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

  it("renders only persisted messages, task assignments, events, and evidence", async () => {
    installFetch(SESSION);
    render(<GrokWorkspace initialSelection={{ sessionId: SESSION.session.id }} />);

    expect(await screen.findByText("I recorded the plan.")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Recorded tool evidence message" })).toHaveTextContent(
      "CI evidence was recorded.",
    );
    const controlCenter = screen.getByRole("complementary", { name: "Session inspector" });
    expect(within(controlCenter).getByRole("button", { name: "pause session" })).toBeEnabled();
    expect(within(controlCenter).getByRole("button", { name: "cancel session" })).toBeEnabled();
    expect(within(controlCenter).getByRole("button", { name: "resume unavailable in running" })).toBeDisabled();

    await userEvent.click(within(controlCenter).getByRole("tab", { name: "Plan" }));
    expect(within(controlCenter).getByText("Inspect checkout")).toBeInTheDocument();
    expect(within(controlCenter).getByText(/after research/)).toBeInTheDocument();

    await userEvent.click(within(controlCenter).getByRole("tab", { name: "Agents" }));
    expect(within(controlCenter).getByText("Observed execution identity")).toBeInTheDocument();
    expect(within(controlCenter).getByText(/recorded node-run evidence/i)).toBeInTheDocument();

    await userEvent.click(within(controlCenter).getByRole("tab", { name: "Tests" }));
    expect(within(controlCenter).getByText("Focused tests")).toBeInTheDocument();
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
        body: JSON.stringify({ projectId: PROJECT.id, prompt: "Fix checkout" }),
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

  it("restores a durable blocked session truthfully after reload", async () => {
    installFetch(BLOCKED_SESSION);
    render(<GrokWorkspace initialSelection={{ sessionId: BLOCKED_SESSION.session.id }} />);

    expect(await screen.findByText("The session and plan are saved, but no graph or worker execution has started.")).toBeInTheDocument();
    const inspector = screen.getByRole("complementary", { name: "Session inspector" });
    expect(within(inspector).getByRole("button", { name: "cancel unavailable in blocked" })).toBeDisabled();
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

  it("sends the runtime cancel action and renders the returned durable state", async () => {
    const fetchMock = installFetch(SESSION);
    const user = userEvent.setup();
    render(<GrokWorkspace initialSelection={{ sessionId: SESSION.session.id }} />);

    const inspector = await screen.findByRole("complementary", { name: "Session inspector" });
    await user.click(within(inspector).getByRole("button", { name: "cancel session" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/grok/sessions/${SESSION.session.id}/control`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"action":"cancel"'),
      }),
    ));
    expect(screen.getAllByText("cancelled").length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveTextContent("Cancellation was recorded");
  });
});
