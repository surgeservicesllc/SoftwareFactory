import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GettingStarted } from "@/components/getting-started";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

/** A fetch stub keyed by the four sources the guide reads; unset ones default to empty. */
function stubSources(sources: {
  projects?: unknown;
  projectsStatus?: number;
  connections?: unknown;
  worker?: unknown;
  commands?: unknown;
  accounts?: unknown;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/projects") {
      return jsonResponse(sources.projects ?? { projects: [] }, sources.projectsStatus ?? 200);
    }
    if (url === "/api/github/connections") return jsonResponse(sources.connections ?? { connections: [] });
    if (url === "/api/worker/status") return jsonResponse(sources.worker ?? { worker: { connectionStatus: "not_connected" } });
    if (url === "/api/commands") return jsonResponse(sources.commands ?? { commands: [] });
    if (url === "/api/ai-accounts") return jsonResponse(sources.accounts ?? { accounts: [] });
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const connectedProject = {
  projects: [
    {
      id: "project-1",
      githubRepository: "example/repo",
      defaultBranch: "main",
      connectionId: "connection-1",
      connectionStatus: "connected",
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

describe("GettingStarted", () => {
  it("shows the four-step journey and does not fetch for a signed-out visitor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<GettingStarted authenticated={false} />);

    expect(await screen.findByRole("heading", { name: "Get started" })).toBeInTheDocument();
    // The journey ends at giving a goal, not at browsing files.
    expect(screen.getByText("Connect GitHub")).toBeInTheDocument();
    expect(screen.getByText("Add a project")).toBeInTheDocument();
    expect(screen.getByText("Check your AI worker")).toBeInTheDocument();
    expect(screen.getByText("Give your Factory a goal")).toBeInTheDocument();
    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links each incomplete step directly to the screen that finishes it", async () => {
    stubSources({});

    render(<GettingStarted authenticated />);

    await screen.findByText("0 of 5 done");
    const connect = screen.getByText("Connect GitHub").closest("li")!;
    expect(within(connect).getByRole("link")).toHaveAttribute("href", "/solutions/connections");
    const project = screen.getByText("Add a project").closest("li")!;
    expect(within(project).getByRole("link")).toHaveAttribute("href", "/solutions/projects");
    const worker = screen.getByText("Check your AI worker").closest("li")!;
    expect(within(worker).getByRole("link")).toHaveAttribute("href", "/solutions/bot-manager");
    const goal = screen.getByText("Give your Factory a goal").closest("li")!;
    expect(within(goal).getByRole("link")).toHaveAttribute("href", "/solutions/bot-manager");
  });

  it("marks GitHub and project done from a connected project", async () => {
    stubSources({ projects: connectedProject });

    render(<GettingStarted authenticated />);

    await screen.findByText("2 of 5 done");
    // The worker and goal steps stay open until their own signals arrive.
    const worker = screen.getByText("Check your AI worker").closest("li")!;
    expect(within(worker).getByRole("link")).toHaveTextContent("Open Bot Manager");
  });

  it("counts GitHub connected even before a project is linked", async () => {
    stubSources({ connections: { connections: [{ status: "connected" }] } });

    render(<GettingStarted authenticated />);

    await screen.findByText("1 of 5 done");
  });

  it("tracks signing in a provider account as its own step, not the worker's", async () => {
    // A running worker with no account connected used to leave the longest
    // part of setup - signing in to Claude or Codex - unmentioned anywhere in
    // the guide, while a green worker suggested there was nothing left to do.
    stubSources({ worker: { worker: { connectionStatus: "connected" } } });
    const { unmount } = render(<GettingStarted authenticated />);

    await screen.findByText("1 of 5 done");
    const account = screen.getByText("Connect an AI account").closest("li")!;
    expect(within(account).getByRole("link")).toHaveAttribute("href", "/solutions/bot-manager");
    expect(within(account).getByRole("link")).toHaveTextContent("Connect an account");
    unmount();

    // A connected account ticks its own step, and only its own.
    vi.unstubAllGlobals();
    stubSources({ accounts: { accounts: [{ status: "connected" }] } });
    render(<GettingStarted authenticated />);
    await screen.findByText("1 of 5 done");
  });

  it("does not count a disconnected account as connected", async () => {
    stubSources({ accounts: { accounts: [{ status: "needs_reauth" }, { status: "disconnected" }] } });

    render(<GettingStarted authenticated />);

    await screen.findByText("0 of 5 done");
  });

  it("collapses to a single give-a-goal call to action once everything is connected", async () => {
    stubSources({
      projects: connectedProject,
      connections: { connections: [{ status: "connected" }] },
      worker: { worker: { connectionStatus: "connected" } },
      commands: { commands: [{ id: "command-1" }] },
      // "Ready" now genuinely requires a signed-in provider account: a Factory
      // with no Claude or Codex account cannot do the work it promises.
      accounts: { accounts: [{ status: "connected" }] },
    });

    render(<GettingStarted authenticated />);

    expect(await screen.findByText("Your Factory is ready")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /give your factory a goal/i });
    expect(cta).toHaveAttribute("href", "/solutions/bot-manager");
    // The checklist is gone; the ready state is not the same as a step list.
    expect(screen.queryByText("Get started")).not.toBeInTheDocument();
  });

  it("keeps a worker-status failure from blocking the GitHub and project signals", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") return jsonResponse(connectedProject);
      if (url === "/api/github/connections") return jsonResponse({ connections: [{ status: "connected" }] });
      if (url === "/api/worker/status") return jsonResponse({ error: { message: "worker unavailable" } }, 500);
      if (url === "/api/commands") return jsonResponse({ commands: [] });
      if (url === "/api/ai-accounts") return jsonResponse({ accounts: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<GettingStarted authenticated />);

    // GitHub + project still register; the worker step is simply left unchecked.
    await screen.findByText("2 of 5 done");
    expect(screen.getByRole("heading", { name: "Get started" })).toBeInTheDocument();
  });

  it("recovers the ready state on refresh after a goal is submitted", async () => {
    let hasGoal = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") return jsonResponse(connectedProject);
      if (url === "/api/github/connections") return jsonResponse({ connections: [{ status: "connected" }] });
      if (url === "/api/worker/status") return jsonResponse({ worker: { connectionStatus: "connected" } });
      if (url === "/api/commands") return jsonResponse({ commands: hasGoal ? [{ id: "c-1" }] : [] });
      if (url === "/api/ai-accounts") return jsonResponse({ accounts: [{ status: "connected" }] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<GettingStarted authenticated />);

    await screen.findByText("4 of 5 done");
    hasGoal = true;
    await user.click(screen.getByRole("button", { name: /refresh setup status/i }));

    expect(await screen.findByText("Your Factory is ready")).toBeInTheDocument();
  });
});
