import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiFactoryConsole } from "@/components/ai-factory-console";
import type { PipelineTemplateSummary } from "@/components/pipelines-console";
import { LEAST_PRIVILEGE_CONFIG } from "@/lib/bots/assignment-config";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

const BUILT_INS: PipelineTemplateSummary[] = [
  {
    key: "general_audit",
    name: "General Audit",
    category: "AUDIT",
    summary: "Whole-repository audit across the standard areas.",
    version: 1,
    topology: "fan-out/fan-in",
    nodeCount: 8,
    maxParallelism: 4,
    anchorNodeCount: 0,
    compiles: true,
  },
];

const CONNECTED_ACCOUNT = { id: "account-1", status: "connected" };
const READY_BOT = {
  id: "b1",
  name: "Claude - Daniel",
  aiAccountId: CONNECTED_ACCOUNT.id,
  currentReadiness: "ready",
};
const SECOND_CONNECTED_ACCOUNT = { id: "account-2", status: "connected" };
const SECOND_READY_BOT = {
  id: "b2",
  name: "Codex - Daniel",
  aiAccountId: SECOND_CONNECTED_ACCOUNT.id,
  currentReadiness: "ready",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

/**
 * The `{}` fallback matters here: the embedded consoles (connections, bot
 * manager, roster, composer) fetch their own endpoints when a step's overlay
 * opens, and each must land in its honest empty or gated state on an unknown
 * body — never throw.
 */
type StubbedResponse = unknown | ((init?: RequestInit) => unknown | Promise<unknown>);

function stubFactory(overrides: Partial<Record<string, StubbedResponse>> = {}) {
  const defaults: Record<string, StubbedResponse> = {
    "/api/github/connections": { connections: [] },
    "/api/projects": { projects: [] },
    "/api/ai-accounts": { accounts: [] },
    "/api/bots": { bots: [], assignments: [], assignmentsComplete: true },
    "/api/commands": { commands: [] },
    "/api/project-pipelines": { pipelines: [], canManage: true },
    "/api/pipeline-templates": { templates: [] },
    "/api/worker/status": {
      worker: {
        connectionStatus: "not_connected",
        statusLabel: "Worker Not Connected",
        lastHeartbeatAt: null,
        activeWorkers: 0,
        availableWorkers: 0,
      },
    },
  };
  const bodies = { ...defaults, ...overrides };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url in bodies) {
      const configured = bodies[url];
      const value = typeof configured === "function"
        ? await configured(init)
        : configured;
      if (value instanceof Error) throw value;
      if (value instanceof Response) return value;
      return jsonResponse(
        url === "/api/bots" && value !== null && typeof value === "object" && !Array.isArray(value)
          ? { assignmentsComplete: true, ...(value as Record<string, unknown>) }
          : value,
      );
    }
    return jsonResponse({});
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  routerPush.mockReset();
  window.localStorage.clear();
});

describe("AiFactoryConsole", () => {
  it("keeps the page heading visible while the workspace snapshot is loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    expect(screen.getAllByRole("heading", { level: 1, name: "AI Factory" })).toHaveLength(1);
    expect(screen.getByLabelText("Loading the factory")).toBeInTheDocument();
  });

  it("starts an empty workspace at Connect Repository, with nothing opening uninvited", async () => {
    stubFactory();

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const first = (await screen.findByText("Connect Repository")).closest("li") as HTMLElement;
    expect(within(first).getByText("You are here")).toBeInTheDocument();
    // Every option opens over the page — announced on the button — but only
    // when chosen: no dialog is open on arrival.
    expect(within(first).getByRole("button", { name: /connect github/i })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("0 of 9 complete")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1, name: "AI Factory" })).toHaveLength(1);
  });

  it("keeps Connect Repository incomplete until at least one repository is authorized", async () => {
    stubFactory({
      "/api/github/connections": {
        connections: [{
          status: "connected",
          installation: { id: 1 },
          repositories: [],
        }],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const step = (await screen.findByText("Connect Repository")).closest("li") as HTMLElement;
    expect(within(step).getByText(/1 installation · 0 repositories authorized/)).toBeInTheDocument();
    expect(within(step).queryByText("Done")).not.toBeInTheDocument();
    expect(screen.getByText("0 of 9 complete")).toBeInTheDocument();
  });

  it("derives progress from the live records and shows the live evidence in its overlay", async () => {
    stubFactory({
      "/api/github/connections": {
        connections: [{
          status: "connected",
          installation: { id: 1 },
          repositories: [{ selected: true, archived: false }],
        }],
      },
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/ai-accounts": { accounts: [CONNECTED_ACCOUNT] },
      "/api/bots": {
        bots: [READY_BOT],
        // Configured means somebody moved this posting off the least-privilege
        // default. The fixture said only `roleId: "builder"`, which every
        // assignment has, and the step counted as done for that reason alone.
        assignments: [{
          id: "a1",
          botId: READY_BOT.id,
          projectId: "p1",
          roleId: "builder",
          status: "active",
          config: { ...LEAST_PRIVILEGE_CONFIG, responsibilities: ["Ship search"] },
        }],
      },
      "/api/worker/status": {
        worker: {
          connectionStatus: "connected",
          statusLabel: "Worker Connected",
          lastHeartbeatAt: "2026-08-21T20:00:00.000Z",
          activeWorkers: 1,
          availableWorkers: 1,
        },
      },
      "/api/commands": {
        commands: [{ id: "c1", prompt: "Ship search", status: "running", project: { id: "p1", name: "SoftwareFactory" } }],
      },
      "/api/project-agents": {
        available: true,
        canManage: true,
        selections: [{ id: "pa1", projectId: "p1", agentId: "ag1", agentName: "Orchestrator", agentRole: "orchestrator" }],
      },
      "/api/project-pipelines": {
        pipelines: [{ id: "pp1", projectId: "p1", templateKey: "general_audit", name: "General Audit" }],
        canManage: true,
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    // Eight steps are complete; only "Watch It Ship" remains, because no
    // command has succeeded yet.
    expect(await screen.findByText("8 of 9 complete")).toBeInTheDocument();
    const connect = screen.getByText("Connect Bots").closest("li") as HTMLElement;
    expect(within(connect).getByText(/1 ready bot linked to 1 connected account/)).toBeInTheDocument();
    expect(within(connect).getByRole("list", { name: "Ready connected bots" })).toHaveTextContent(
      "Claude - Daniel",
    );
    const watch = screen.getByText("Watch It Ship").closest("li") as HTMLElement;
    expect(within(watch).getByText("You are here")).toBeInTheDocument();
    expect(within(watch).getByText(/Work is in flight/)).toBeInTheDocument();

    fireEvent.click(within(watch).getByRole("button", { name: /watch execution/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Command execution")).toBeInTheDocument();
    expect(within(dialog).getByText("Worker Connected")).toBeInTheDocument();
    expect(within(dialog).getByText("Ship search")).toBeInTheDocument();
    expect(within(dialog).getByText("Building")).toBeInTheDocument();
  });

  it("opens the real embedded control in an overlay and closes back to the page", async () => {
    stubFactory();

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const create = (await screen.findByText("Create Project")).closest("li") as HTMLElement;
    fireEvent.click(within(create).getByRole("button", { name: /create a project/i }));

    // The embedded add-project form runs its own reads and lands on its own
    // honest gate: no GitHub connection means no form, stated plainly.
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Connect GitHub first")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("traps focus, isolates the page, and restores focus to the step opener", async () => {
    stubFactory();
    const user = userEvent.setup();

    const { container } = render(
      <div data-testid="application-shell">
        <a href="#factory-main">Skip to content</a>
        <aside>Console navigation</aside>
        <header>Mobile header</header>
        <main id="factory-main"><AiFactoryConsole builtIns={BUILT_INS} /></main>
      </div>,
    );
    // Adversarial pre-existing values must be restored exactly, not merely
    // removed. This container represents the real AppShell root: inerting it
    // isolates its skip link, sidebar, header, and main in one operation.
    container.setAttribute("inert", "pre-existing");
    container.setAttribute("aria-hidden", "false");

    const create = (await screen.findByText("Create Project")).closest("li") as HTMLElement;
    const opener = within(create).getByRole("button", { name: /create a project/i });
    const skipLink = screen.getByRole("link", { name: "Skip to content" });
    await user.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Create Project" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(1);
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass("z-[110]");
    expect(container).toHaveAttribute("inert", "");
    expect(container).toHaveAttribute("aria-hidden", "true");

    // Programmatic focus cannot escape either; the trap returns it to the
    // requested first control rather than relying only on Tab wrapping.
    skipLink.focus();
    expect(close).toHaveFocus();

    const lastLink = within(dialog).getAllByRole("link").at(-1)!;
    await user.tab({ shift: true });
    expect(lastLink).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(container).toHaveAttribute("inert", "pre-existing");
    expect(container).toHaveAttribute("aria-hidden", "false");
    expect(opener).toHaveFocus();
  });

  it("keeps pipeline Plan and Clone on the AI Factory's single modal surface", async () => {
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/pipeline-templates": { templates: [], canManage: true },
      "/api/project-pipelines": { pipelines: [], available: true, canManage: true },
    });
    const user = userEvent.setup();

    render(<AiFactoryConsole builtIns={BUILT_INS} />);
    const pipeline = (await screen.findByText("Configure Pipeline")).closest("li") as HTMLElement;
    await user.click(within(pipeline).getByRole("button", { name: /choose a pipeline/i }));

    const factoryDialog = await screen.findByRole("dialog", { name: "Configure Pipeline" });
    await user.click(await within(factoryDialog).findByRole("button", {
      name: "Plan a graph from General Audit",
    }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(factoryDialog).getByRole("region", {
      name: "Plan a graph from General Audit",
    })).toBeInTheDocument();
    expect(within(factoryDialog).getAllByRole("button", { name: "Close" })).toHaveLength(1);
    await user.click(within(factoryDialog).getByRole("button", { name: "Back to templates" }));

    await user.click(await within(factoryDialog).findByRole("button", { name: "Clone General Audit" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(factoryDialog).getByRole("region", { name: "New template" })).toBeInTheDocument();
    expect(within(factoryDialog).getAllByRole("button", { name: "Close" })).toHaveLength(1);
    expect(within(factoryDialog).getByRole("button", { name: "Back to templates" }))
      .toBeInTheDocument();
  });

  it("routes X, Escape, and backdrop closes through broker cancellation and vetoes failures", async () => {
    let cancelAttempts = 0;
    const session = {
      id: "session-1",
      accountId: "account-1",
      status: "pending",
      loginUrl: null,
      failureReason: null,
      heartbeatAt: null,
      expiresAt: "2026-08-22T12:00:00.000Z",
    };
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/ai-accounts": { accounts: [], canManage: true },
      "/api/bots": {
        activeOrganizationId: "org-1",
        bots: [],
        assignments: [],
        roles: [],
        projects: [{ id: "p1", name: "SoftwareFactory" }],
        canManage: true,
      },
      "/api/ai-accounts/connect": { sessionId: "session-1" },
      "/api/ai-accounts/sessions/session-1": { session },
      "/api/ai-accounts/sessions/session-1/cancel": () => {
        cancelAttempts += 1;
        return cancelAttempts < 3
          ? jsonResponse({ error: { message: "The broker is unavailable. Try again shortly." } }, 503)
          : jsonResponse({ cancelled: true });
      },
    });
    const user = userEvent.setup();

    render(<AiFactoryConsole builtIns={BUILT_INS} />);
    const connect = (await screen.findByText("Connect Bots")).closest("li") as HTMLElement;
    await user.click(within(connect).getByRole("button", { name: "Connect an account" }));

    const dialog = await screen.findByRole("dialog", { name: "Connect Bots" });
    await user.click(await within(dialog).findByRole("button", { name: /connect claude/i }));
    await user.click(await within(dialog).findByRole("button", { name: /continue to claude/i }));
    await within(dialog).findByText("Connecting Claude");
    await waitFor(() => expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(1));

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /sign-in is still active.*broker is unavailable.*try again/i,
    );
    expect(cancelAttempts).toBe(1);
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(cancelAttempts).toBe(2));
    expect(dialog).toBeInTheDocument();

    fireEvent.mouseDown(dialog);
    await waitFor(() => expect(cancelAttempts).toBe(3));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Connect Bots" }))
      .not.toBeInTheDocument());
  });

  it("vetoes same-control navigation until the active broker session is cancelled", async () => {
    let cancelAttempts = 0;
    const session = {
      id: "session-navigation",
      accountId: "account-navigation",
      status: "pending",
      loginUrl: null,
      failureReason: null,
      heartbeatAt: null,
      expiresAt: "2026-08-22T12:00:00.000Z",
    };
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/ai-accounts": { accounts: [], canManage: true },
      "/api/bots": {
        activeOrganizationId: "org-1",
        bots: [],
        assignments: [],
        roles: [],
        projects: [{ id: "p1", name: "SoftwareFactory" }],
        canManage: true,
      },
      "/api/ai-accounts/connect": { sessionId: session.id },
      [`/api/ai-accounts/sessions/${session.id}`]: { session },
      [`/api/ai-accounts/sessions/${session.id}/cancel`]: () => {
        cancelAttempts += 1;
        return cancelAttempts === 1
          ? jsonResponse({ error: { message: "Cancellation evidence is unavailable." } }, 503)
          : jsonResponse({ cancelled: true });
      },
    });
    const user = userEvent.setup();

    render(<AiFactoryConsole builtIns={BUILT_INS} />);
    const connect = (await screen.findByText("Connect Bots")).closest("li") as HTMLElement;
    await user.click(within(connect).getByRole("button", { name: "Connect an account" }));

    const dialog = await screen.findByRole("dialog", { name: "Connect Bots" });
    await user.click(await within(dialog).findByRole("button", { name: /connect claude/i }));
    await user.click(await within(dialog).findByRole("button", { name: /continue to claude/i }));
    await within(dialog).findByText("Connecting Claude");

    const managerLink = within(dialog).getByRole("link", { name: "Bot Manager" });
    await user.click(managerLink);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /sign-in is still active.*cancellation evidence is unavailable/i,
    );
    expect(cancelAttempts).toBe(1);
    expect(routerPush).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();

    await user.click(managerLink);
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/solutions/bot-manager"));
    expect(cancelAttempts).toBe(2);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Connect Bots" }))
      .not.toBeInTheDocument());
  });

  it("returns to the journey on its own once the overlay's control completes", async () => {
    let created = false;
    stubFactory({
      "/api/github/connections": {
        connections: [{
          id: "conn1",
          status: "connected",
          account: { login: "surge", type: "User" },
          installation: { id: 7, suspendedAt: null },
          repositories: [
            { id: 42, fullName: "surge/app", defaultBranch: "main", archived: false, selected: true },
          ],
        }],
      },
      "/api/projects": (init?: RequestInit) => {
        if (init?.method === "POST") {
          created = true;
          return { project: { id: "created-project" } };
        }
        return {
          projects: created
            ? [{ id: "created-project", name: "app", githubRepositoryId: 42 }]
            : [],
        };
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const create = (await screen.findByText("Create Project")).closest("li") as HTMLElement;
    fireEvent.click(within(create).getByRole("button", { name: /create a project/i }));

    const dialog = await screen.findByRole("dialog");
    // The form prefills from the selected repository; submitting creates the
    // project and the overlay closes itself — selection made, journey resumed.
    const submit = await within(dialog).findByRole("button", { name: /add project/i });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("counts only configured assignments for the configure step", async () => {
    // Every assignment carries a role: `bot_assignments.role_id` is NOT NULL,
    // so a fixture without one describes a record the database cannot hold.
    // This step used to be derived from `roleId || responsibilities.length` --
    // a field the payload nests under `config`, plus a column that is always
    // set -- so it was marked done the moment a bot was assigned and could
    // never read as outstanding. What counts is whether somebody moved the
    // posting off its least-privilege default.
    stubFactory({
      "/api/ai-accounts": { accounts: [CONNECTED_ACCOUNT] },
      "/api/bots": {
        assignments: [
          { id: "a1", botId: READY_BOT.id, projectId: "p1", roleId: "role-1", status: "active", config: LEAST_PRIVILEGE_CONFIG },
          { id: "a2", botId: READY_BOT.id, projectId: "p1", roleId: "role-1", status: "released", config: { ...LEAST_PRIVILEGE_CONFIG, preset: "builder" } },
        ],
        bots: [READY_BOT],
      },
      // An assignment names a project, so the project has to exist for the
      // fixture to describe a state the database could actually hold.
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const configure = (await screen.findByText("Configure Bot Settings")).closest("li") as HTMLElement;
    expect(within(configure).getByText(/still on the default least-privilege settings/)).toBeInTheDocument();
  });

  it("marks the configure step done once a posting is actually configured", async () => {
    stubFactory({
      "/api/ai-accounts": { accounts: [CONNECTED_ACCOUNT] },
      "/api/bots": {
        assignments: [
          {
            id: "a1",
            botId: READY_BOT.id,
            projectId: "p1",
            roleId: "role-1",
            status: "active",
            config: { ...LEAST_PRIVILEGE_CONFIG, responsibilities: ["Review migrations"] },
          },
        ],
        bots: [READY_BOT],
      },
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const configure = (await screen.findByText("Configure Bot Settings")).closest("li") as HTMLElement;
    expect(within(configure).getByText(/1 of 1 assignment configured/)).toBeInTheDocument();
  });

  it("fails assignment-derived progress closed without a complete-roster proof", async () => {
    stubFactory({
      "/api/ai-accounts": { accounts: [CONNECTED_ACCOUNT] },
      // A rolling/legacy response can contain a convincing prefix without the
      // new proof. It must not complete either assignment-derived step.
      "/api/bots": jsonResponse({
        assignments: [{
          id: "a1",
          botId: READY_BOT.id,
          projectId: "p1",
          roleId: "role-1",
          status: "active",
          config: { ...LEAST_PRIVILEGE_CONFIG, responsibilities: ["Review migrations"] },
        }],
        bots: [READY_BOT],
      }),
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const assign = (await screen.findByText("Assign Bots to Project")).closest("li") as HTMLElement;
    const configure = screen.getByText("Configure Bot Settings").closest("li") as HTMLElement;
    expect(within(assign).getByText(/assignment roster is incomplete/i)).toBeInTheDocument();
    expect(within(configure).getByText(/assignment roster is incomplete/i)).toBeInTheDocument();
    expect(within(assign).queryByText("Done")).not.toBeInTheDocument();
    expect(within(configure).queryByText("Done")).not.toBeInTheDocument();
  });

  it("counts a non-default posting model as configured", async () => {
    stubFactory({
      "/api/ai-accounts": { accounts: [CONNECTED_ACCOUNT] },
      "/api/bots": {
        assignments: [{
          id: "a1",
          botId: READY_BOT.id,
          projectId: "p1",
          roleId: "role-1",
          status: "active",
          config: LEAST_PRIVILEGE_CONFIG,
          model: "gpt-5.4",
          workEffort: "medium",
        }],
        bots: [READY_BOT],
      },
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const configure = (await screen.findByText("Configure Bot Settings")).closest("li") as HTMLElement;
    expect(within(configure).getByText(/1 of 1 assignment configured/)).toBeInTheDocument();
  });

  it("keeps configure incomplete until every active posting is configured", async () => {
    stubFactory({
      "/api/ai-accounts": { accounts: [CONNECTED_ACCOUNT, SECOND_CONNECTED_ACCOUNT] },
      "/api/bots": {
        assignments: [
          {
            id: "a1",
            botId: READY_BOT.id,
            projectId: "p1",
            roleId: "role-1",
            status: "active",
            config: { ...LEAST_PRIVILEGE_CONFIG, responsibilities: ["Review migrations"] },
          },
          {
            id: "a2",
            botId: SECOND_READY_BOT.id,
            projectId: "p1",
            roleId: "role-2",
            status: "active",
            config: LEAST_PRIVILEGE_CONFIG,
          },
        ],
        bots: [READY_BOT, SECOND_READY_BOT],
      },
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const configure = (await screen.findByText("Configure Bot Settings")).closest("li") as HTMLElement;
    expect(within(configure).getByText(/1 of 2 assignments configured/)).toBeInTheDocument();
    expect(within(configure).queryByText("Done")).not.toBeInTheDocument();
  });

  it("has one project scope for the journey and its roster", async () => {
    // There must not be a second project picker inside the roster. It could
    // diverge from the factory picker and send writes to a project whose
    // evidence the journey was not measuring.
    stubFactory({
      "/api/projects": {
        projects: [
          { id: "p1", name: "First Project" },
          { id: "p2", name: "Second Project" },
        ],
      },
      "/api/bots": { bots: [{ id: "b1" }], assignments: [] },
      "/api/projects/p2/bots": {
        canManage: true,
        assigned: [],
        roles: [],
        available: [],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    // Pick the second project as the factory being built.
    const picker = await screen.findByLabelText("Factory");
    fireEvent.change(picker, { target: { value: "p2" } });

    const assign = (await screen.findByText("Assign Bots to Project")).closest("li") as HTMLElement;
    fireEvent.click(within(assign).getByRole("button", { name: /assign a bot|assign/i }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => (
      String(input) === "/api/projects/p2/bots"
    ))).toBe(true));
    expect(within(dialog).queryByLabelText("Project")).not.toBeInTheDocument();
  });

  it("does not call Connect Bots done when an account has not produced a bot", async () => {
    stubFactory({
      "/api/ai-accounts": { accounts: [CONNECTED_ACCOUNT] },
      "/api/bots": { bots: [], assignments: [] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const connect = (await screen.findByText("Connect Bots")).closest("li") as HTMLElement;
    expect(within(connect).getByText(/1 account connected · no bot linked to those accounts yet/i)).toBeInTheDocument();
    expect(within(connect).queryByText("Done")).not.toBeInTheDocument();
    expect(within(connect).getByRole("button", { name: "Create a bot" })).toBeInTheDocument();
  });

  it("does not correlate an unrelated connected account and ready bot", async () => {
    stubFactory({
      "/api/ai-accounts": { accounts: [CONNECTED_ACCOUNT] },
      "/api/bots": {
        bots: [{ ...READY_BOT, aiAccountId: "different-account" }],
        assignments: [],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const connect = (await screen.findByText("Connect Bots")).closest("li") as HTMLElement;
    expect(within(connect).queryByText("Done")).not.toBeInTheDocument();
    expect(within(connect).getByText(/no bot linked to those accounts yet/i)).toBeInTheDocument();
  });

  it("requires current readiness and the same bot on the active project's assignment", async () => {
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/ai-accounts": { accounts: [CONNECTED_ACCOUNT] },
      "/api/bots": {
        bots: [{ ...READY_BOT, currentReadiness: "not_connected" }],
        assignments: [{
          id: "assignment-1",
          botId: READY_BOT.id,
          projectId: "p1",
          roleId: "role-1",
          status: "active",
          config: { ...LEAST_PRIVILEGE_CONFIG, responsibilities: ["Review"] },
        }],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const connect = (await screen.findByText("Connect Bots")).closest("li") as HTMLElement;
    expect(within(connect).getByText(/1 linked bot · none currently ready/i)).toBeInTheDocument();
    expect(within(connect).queryByText("Done")).not.toBeInTheDocument();

    const assign = screen.getByText("Assign Bots to Project").closest("li") as HTMLElement;
    expect(within(assign).getByText(/none route a ready bot linked to a connected account/i)).toBeInTheDocument();
    expect(within(assign).queryByText("Done")).not.toBeInTheDocument();

    const configure = screen.getByText("Configure Bot Settings").closest("li") as HTMLElement;
    expect(within(configure).getByText(/not backed by a ready bot linked to a connected account/i)).toBeInTheDocument();
    expect(within(configure).queryByText("Done")).not.toBeInTheDocument();
  });

  it("keeps assignment inside the AI Factory dialog instead of stacking a second modal", async () => {
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/bots": { bots: [{ id: "bot-1" }], assignments: [] },
      "/api/projects/p1/bots": {
        canManage: true,
        assigned: [],
        roles: [{ id: "role-1", name: "Developer", slug: "developer", summary: "Builds" }],
        available: [{
          id: "bot-1",
          name: "Claude - Daniel",
          provider: "anthropic",
          providerLabel: "Claude",
          providerVendor: "Anthropic",
          model: "claude-opus-5",
          currentReadiness: "ready",
          readinessLabel: "Ready to assign",
          readinessTone: "safe",
          aiAccountId: "account-1",
          assignable: true,
          blockedReason: null,
          alreadyOnThisProject: false,
          currentProjectId: null,
          currentProjectName: null,
          currentRoleId: null,
          workload: 0,
        }],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const assign = (await screen.findByText("Assign Bots to Project")).closest("li") as HTMLElement;
    fireEvent.click(within(assign).getByRole("button", { name: /assign bots/i }));
    const factoryDialog = await screen.findByRole("dialog", { name: "Assign Bots to Project" });
    fireEvent.click(await within(factoryDialog).findByRole("button", { name: "Assign Bots" }));

    expect(await within(factoryDialog).findByLabelText("Select Claude - Daniel")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(factoryDialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    fireEvent.click(within(factoryDialog).getByLabelText("Select Claude - Daniel"));
    fireEvent.click(within(factoryDialog).getByRole("button", { name: "Next" }));
    expect(await within(factoryDialog).findByLabelText("Role for Claude - Daniel")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("keeps Connect Bots account and bot stages inside the AI Factory dialog", async () => {
    const account = {
      id: "account-1",
      provider: "anthropic",
      providerLabel: "Claude",
      credentialPurpose: "claude",
      displayName: "Claude - Daniel",
      status: "connected",
      lastError: null,
    };
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/ai-accounts": { accounts: [account], canManage: true },
      "/api/bots": {
        activeOrganizationId: "org-1",
        bots: [],
        assignments: [],
        roles: [],
        projects: [{ id: "p1", name: "SoftwareFactory" }],
        canManage: true,
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);
    const connect = (await screen.findByText("Connect Bots")).closest("li") as HTMLElement;
    fireEvent.click(within(connect).getByRole("button", { name: "Create a bot" }));
    const factoryDialog = await screen.findByRole("dialog", { name: "Connect Bots" });
    fireEvent.click(await within(factoryDialog).findByRole("button", { name: "Create Bot" }));

    expect(await within(factoryDialog).findByRole("button", { name: /Claude - Daniel/ }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(factoryDialog).getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });

  it("does not mark the pipeline configured just because a project exists", async () => {
    // `done` for this step was the same expression as the step above it
    // (`activeProject !== null`), so creating a project marked the pipeline
    // configured and the step could never read as outstanding. It is derived
    // from what actually compiles now, and from the tenant's own templates.
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/pipeline-templates": { templates: [] },
    });

    render(<AiFactoryConsole builtIns={[]} />);

    const pipeline = (await screen.findByText("Configure Pipeline")).closest("li") as HTMLElement;
    expect(within(pipeline).getByText("No pipeline template compiles right now")).toBeInTheDocument();
    // Create Project is the only step satisfied here; the pipeline step is not.
    expect(await screen.findByText("1 of 9 complete")).toBeInTheDocument();
  });

  it("counts the tenant's own pipeline templates as evidence", async () => {
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/pipeline-templates": { templates: [{ id: "t1", slug: "fake_review_pipeline" }] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const pipeline = (await screen.findByText("Configure Pipeline")).closest("li") as HTMLElement;
    expect(within(pipeline).getByText(/1 custom template/)).toBeInTheDocument();
  });

  it("says the executor is Not Connected rather than promising a run that cannot start", async () => {
    // The step's whole subject is shipping. With nothing to execute a command,
    // it said "Every run lands as a draft pull request" and "Work is in
    // flight" over a command that would sit queued indefinitely.
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/bots": {
        bots: [{ id: "b1" }],
        assignments: [],
      },
      "/api/worker/status": {
        worker: {
          connectionStatus: "not_connected",
          statusLabel: "Worker Not Connected",
          lastHeartbeatAt: null,
          activeWorkers: 0,
          availableWorkers: 0,
        },
      },
      "/api/commands": {
        commands: [{ id: "c1", prompt: "Ship search", status: "queued", project: { id: "p1", name: "SoftwareFactory" } }],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const command = (await screen.findByText("Issue a Command")).closest("li") as HTMLElement;
    expect(within(command).getByText(/without dispatching a worker/i)).toBeInTheDocument();
    expect(within(command).queryByText(/a worker builds it/i)).not.toBeInTheDocument();

    const watch = (await screen.findByText("Watch It Ship")).closest("li") as HTMLElement;
    expect(within(watch).getByText(/1 command queued; Worker Not Connected/)).toBeInTheDocument();
    expect(within(watch).queryByText(/Work is in flight/)).not.toBeInTheDocument();
    expect(within(watch).getByText(/When an executor is connected/)).toBeInTheDocument();

    fireEvent.click(within(watch).getByRole("button", { name: /watch execution/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Worker Not Connected")).toBeInTheDocument();
    expect(within(dialog).getByText(/will not start until an executor is connected/)).toBeInTheDocument();
  });

  it("treats a missing worker field as Not Connected", async () => {
    // Absent must never read as connected: an older payload, a partial
    // response, or a failed read all land here.
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/bots": { bots: [{ id: "b1" }], assignments: [] },
      "/api/worker/status": {},
      "/api/commands": {
        commands: [{ id: "c1", prompt: "Ship search", status: "queued", project: { id: "p1", name: "SoftwareFactory" } }],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);
    const watch = (await screen.findByText("Watch It Ship")).closest("li") as HTMLElement;
    expect(within(watch).getByText(/1 command queued; Worker Not Connected/)).toBeInTheDocument();
  });

  it("does not call Configure Pipeline done until a pipeline is actually selected", async () => {
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const step = (await screen.findByText("Configure Pipeline")).closest("li") as HTMLElement;
    // A project existing is not a pipeline being chosen. The step used to
    // read done the moment step 2 finished, which made it the one step on
    // the page nobody could ever work on.
    expect(within(step).queryByText("Done")).not.toBeInTheDocument();
    expect(within(step).getByText(/No pipeline selected yet/)).toBeInTheDocument();
    expect(within(step).getByRole("button", { name: /choose a pipeline/i })).toBeInTheDocument();
  });

  it("shows the selected pipelines on the page itself, not only inside the overlay", async () => {
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/project-pipelines": {
        pipelines: [
          { id: "pp1", projectId: "p1", templateKey: "general_audit", name: "General Audit" },
          { id: "pp2", projectId: "p1", templateKey: "rls_audit", name: "RLS Audit" },
          { id: "pp3", projectId: "p2", templateKey: "bug_sweep", name: "Bug Sweep" },
        ],
        canManage: true,
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const step = (await screen.findByText("Configure Pipeline")).closest("li") as HTMLElement;
    expect(within(step).getByText("Done")).toBeInTheDocument();
    expect(within(step).getByText(/2 pipelines selected: General Audit, RLS Audit/)).toBeInTheDocument();

    const chips = within(step).getByRole("list", { name: "Selected pipelines" });
    expect(within(chips).getByText("General Audit")).toBeInTheDocument();
    expect(within(chips).getByText("RLS Audit")).toBeInTheDocument();
    // Another factory's selection belongs to that factory, not this one.
    expect(within(chips).queryByText("Bug Sweep")).not.toBeInTheDocument();
  });

  it("does not let a slower older refresh overwrite newer factory progress", async () => {
    let projectReads = 0;
    let releaseStale!: (value: unknown) => void;
    let markStaleReturned!: () => void;
    const staleProjects = new Promise<unknown>((resolve) => { releaseStale = resolve; });
    const staleReturned = new Promise<void>((resolve) => { markStaleReturned = resolve; });
    stubFactory({
      "/api/projects": async () => {
        projectReads += 1;
        if (projectReads === 2) {
          const value = await staleProjects;
          markStaleReturned();
          return value;
        }
        return {
          projects: [{ id: "p1", name: projectReads >= 3 ? "Newest Factory" : "Initial Factory" }],
        };
      },
      "/api/bots": { activeOrganizationId: "org-1", bots: [], assignments: [] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);
    expect(await screen.findByText("This factory: Initial Factory")).toBeInTheDocument();
    const watch = screen.getByText("Watch It Ship").closest("li") as HTMLElement;

    fireEvent.click(within(watch).getByRole("button", { name: "Watch execution" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }));
    fireEvent.click(within(watch).getByRole("button", { name: "Watch execution" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }));

    expect(await screen.findByText("This factory: Newest Factory")).toBeInTheDocument();
    await act(async () => {
      releaseStale({ projects: [{ id: "p1", name: "Stale Factory" }] });
      await staleReturned;
      for (let flush = 0; flush < 6; flush += 1) await Promise.resolve();
    });

    expect(screen.getByText("This factory: Newest Factory")).toBeInTheDocument();
    expect(screen.queryByText("This factory: Stale Factory")).toBeNull();
  });

  it("restores the organization-scoped factory selection after remount", async () => {
    stubFactory({
      "/api/projects": {
        projects: [
          { id: "p1", name: "First Project" },
          { id: "p2", name: "Second Project" },
        ],
      },
      "/api/bots": {
        activeOrganizationId: "organization-1",
        bots: [],
        assignments: [],
      },
    });

    const firstView = render(<AiFactoryConsole builtIns={BUILT_INS} />);
    const firstPicker = await screen.findByLabelText("Factory");
    expect(firstPicker).toHaveValue("p1");
    fireEvent.change(firstPicker, { target: { value: "p2" } });
    expect(screen.getByText("This factory: Second Project")).toBeInTheDocument();
    firstView.unmount();

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const restoredPicker = await screen.findByLabelText("Factory");
    expect(restoredPicker).toHaveValue("p2");
    expect(screen.getByText("This factory: Second Project")).toBeInTheDocument();
  });

  it("keeps the selected factory and progress when a later projects read fails", async () => {
    let projectReads = 0;
    stubFactory({
      "/api/github/connections": {
        connections: [{
          installation: { id: 1 },
          repositories: [{ archived: false, selected: true }],
          status: "connected",
        }],
      },
      "/api/projects": () => {
        projectReads += 1;
        return projectReads === 1
          ? {
              projects: [
                { id: "p1", name: "First Project" },
                { id: "p2", name: "Second Project" },
              ],
            }
          : jsonResponse({ error: "temporarily unavailable" }, 503);
      },
      "/api/project-pipelines": {
        pipelines: [{ projectId: "p2", templateKey: "general_audit", name: "General Audit" }],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const picker = await screen.findByLabelText("Factory");
    fireEvent.change(picker, { target: { value: "p2" } });
    expect(screen.getByText("This factory: Second Project")).toBeInTheDocument();
    expect(screen.getByText("3 of 9 complete")).toBeInTheDocument();

    // Closing a real step refreshes all nine slices. The second projects read
    // fails, so the selected p2 snapshot must remain intact instead of becoming
    // a fabricated empty factory.
    const connect = screen.getByText("Connect Repository").closest("li") as HTMLElement;
    fireEvent.click(within(connect).getByRole("button", { name: /connect github/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    const warning = await screen.findByRole("alert");
    expect(within(warning).getByText("Factory data may be out of date")).toBeInTheDocument();
    expect(within(warning).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Factory")).toHaveValue("p2");
    expect(screen.getByText("This factory: Second Project")).toBeInTheDocument();
    expect(screen.getByText("3 of 9 complete")).toBeInTheDocument();
  });

  it("shows unavailable with Retry when the first snapshot is incomplete", async () => {
    let projectReads = 0;
    stubFactory({
      "/api/projects": () => {
        projectReads += 1;
        return projectReads === 1
          ? jsonResponse({ error: "temporarily unavailable" }, 503)
          : { projects: [] };
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    expect(await screen.findByRole("heading", { name: "AI Factory is unavailable" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1, name: "AI Factory" })).toHaveLength(1);
    expect(screen.queryByText("0 of 9 complete")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("0 of 9 complete")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI Factory is unavailable" })).not.toBeInTheDocument();
  });

  it.each([
    ["a rejected read", new Error("network down")],
    ["unreadable JSON", new Response("{", { status: 200 })],
  ])("shows unavailable instead of partial progress for %s", async (_label, failure) => {
    stubFactory({ "/api/commands": failure });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    expect(await screen.findByRole("heading", { name: "AI Factory is unavailable" })).toBeInTheDocument();
    expect(screen.queryByText("0 of 9 complete")).not.toBeInTheDocument();
  });

  it("recognizes a 401 from any required read", async () => {
    stubFactory({ "/api/projects": jsonResponse({}, 401) });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    expect(await screen.findByText("Sign in to run your factory")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1, name: "AI Factory" })).toHaveLength(1);
  });

  it("recognizes a 409 from any required read", async () => {
    stubFactory({ "/api/commands": jsonResponse({}, 409) });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    expect(await screen.findByText("Finish setting up")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1, name: "AI Factory" })).toHaveLength(1);
  });

  it("fails closed for a signed-out visitor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    expect(await screen.findByText("Sign in to run your factory")).toBeInTheDocument();
  });

  it("keeps the page's heading in every state it can render in", async () => {
    // A blocked state used to replace the page, h1 and all: the console that
    // could not read its data rendered a titleless panel with no place in the
    // heading outline. Caught by the /solutions/ai-factory page check once the
    // unavailable state made a blocked state reachable without a session.
    for (const status of [401, 409, 503]) {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, status)));
      const view = render(<AiFactoryConsole builtIns={BUILT_INS} />);
      expect(
        await within(view.container).findByRole("heading", { level: 1, name: "AI Factory" }),
        `status ${status} renders no page heading`,
      ).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("Create New AI Factory", () => {
  const twoProjects = {
    "/api/ai-accounts": { accounts: [CONNECTED_ACCOUNT] },
    "/api/bots": {
      assignments: [
        {
          id: "assignment-1",
          botId: READY_BOT.id,
          projectId: "p1",
          config: { ...LEAST_PRIVILEGE_CONFIG, responsibilities: ["ship"] },
          roleId: "r1",
          status: "active",
        },
      ],
      bots: [READY_BOT],
    },
    "/api/commands": {
      commands: [
        { id: "c1", project: { id: "p1", name: "First" }, prompt: "go", status: "succeeded" },
      ],
    },
    "/api/projects": { projects: [{ id: "p1", name: "First" }] },
  };

  it("scopes the journey to one factory and starts a new one without deleting anything", async () => {
    stubFactory(twoProjects);
    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    // The existing factory reads its own live records.
    await waitFor(() => {
      expect(screen.getByText(/This factory: First/)).toBeInTheDocument();
    });
    expect(screen.getByText(/1 ready bot route on this factory/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Create New AI Factory/i }));

    // Nothing was deleted: the steps are empty because the new factory has no
    // project yet, and the message says so rather than implying a wipe.
    await waitFor(() => {
      expect(screen.getByText(/Nothing was deleted/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/No project yet for this factory/)).toBeInTheDocument();
    expect(screen.getByText(/No active bot assignment on this factory yet/)).toBeInTheDocument();
  });

  it("keeps the account-level GitHub step done for a brand-new factory", async () => {
    stubFactory({
      ...twoProjects,
      "/api/github/connections": {
        connections: [{
          installation: { id: 1 },
          repositories: [{ archived: false, selected: true }],
          status: "connected",
        }],
      },
    });
    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Create New AI Factory/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Create New AI Factory/i }));

    // An installation belongs to the account, not to one factory, so it stays
    // genuinely done. Resetting it would be a lie in the other direction.
    await waitFor(() => {
      expect(screen.getByText(/1 installation/)).toBeInTheDocument();
    });
  });

  it("does not carry another factory's queued command count into a new factory", async () => {
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "First" }] },
      "/api/commands": {
        commands: Array.from({ length: 6 }, (_, index) => ({
          id: `c${index + 1}`,
          project: { id: "p1", name: "First" },
          prompt: `queued command ${index + 1}`,
          status: "queued",
        })),
      },
    });
    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const originalWatch = (await screen.findByText("Watch It Ship")).closest("li") as HTMLElement;
    expect(within(originalWatch).getByText(/6 commands queued/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Create New AI Factory/i }));
    const createDialog = await screen.findByRole("dialog");
    fireEvent.click(within(createDialog).getByRole("button", { name: "Close" }));

    const newWatch = (await screen.findByText("Watch It Ship")).closest("li") as HTMLElement;
    expect(within(newWatch).getByText("Nothing has run yet")).toBeInTheDocument();
    expect(within(newWatch).queryByText(/6 commands queued/)).not.toBeInTheDocument();

    fireEvent.click(within(newWatch).getByRole("button", { name: /watch execution/i }));
    const watchDialog = await screen.findByRole("dialog");
    expect(within(watchDialog).getByText(/No commands yet/)).toBeInTheDocument();
  });

  it("does not let a new factory fall back to an existing project", async () => {
    stubFactory(twoProjects);
    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    fireEvent.click(await screen.findByRole("button", { name: /Create New AI Factory/i }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    const assign = (await screen.findByText("Assign Bots to Project")).closest("li") as HTMLElement;
    fireEvent.click(within(assign).getByRole("button", { name: /assign bots/i }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/opens once your first project exists/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    const command = (await screen.findByText("Issue a Command")).closest("li") as HTMLElement;
    fireEvent.click(within(command).getByRole("button", { name: /give a bot work/i }));
    dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("option", {
      name: "Create this factory's project first",
    })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Queue command" })).toBeDisabled();

    expect(vi.mocked(fetch).mock.calls.some(([input]) => (
      String(input).includes("/api/projects/p1/bots")
    ))).toBe(false);
  });

  it("selects the exact created project when another member creates one concurrently", async () => {
    let created = false;
    stubFactory({
      "/api/bots": {
        activeOrganizationId: "organization-race",
        bots: [],
        assignments: [],
      },
      "/api/github/connections": {
        connections: [{
          id: "conn1",
          status: "connected",
          account: { login: "surge", type: "User" },
          installation: { id: 7, suspendedAt: null },
          repositories: [{
            id: 42,
            fullName: "surge/ours",
            defaultBranch: "main",
            archived: false,
            selected: true,
          }],
        }],
      },
      "/api/projects": (init?: RequestInit) => {
        if (init?.method === "POST") {
          created = true;
          return { project: { id: "ours-exact-id" } };
        }
        if (!created) {
          return {
            projects: [{ id: "existing", name: "Existing", githubRepositoryId: 41 }],
          };
        }
        // A concurrent tab/member's project is deliberately first. The old
        // first-unseen heuristic selected it instead of the POST response id.
        return {
          projects: [
            { id: "other-member", name: "Concurrent project", githubRepositoryId: 43 },
            { id: "existing", name: "Existing", githubRepositoryId: 41 },
            { id: "ours-exact-id", name: "Our exact project", githubRepositoryId: 42 },
          ],
        };
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);
    expect(await screen.findByText("This factory: Existing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Create New AI Factory/i }));

    const dialog = await screen.findByRole("dialog");
    const submit = await within(dialog).findByRole("button", { name: "Add project" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("This factory: Our exact project")).toBeInTheDocument();
    expect(screen.getByLabelText("Factory")).toHaveValue("ours-exact-id");
    expect(window.localStorage.getItem(
      "softwarefactory:ai-factory:selected-project:organization-race",
    )).toBe("ours-exact-id");
    expect(screen.queryByText("This factory: Concurrent project")).not.toBeInTheDocument();
  });
});
