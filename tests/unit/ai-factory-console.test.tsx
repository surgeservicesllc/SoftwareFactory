import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiFactoryConsole } from "@/components/ai-factory-console";
import type { PipelineTemplateSummary } from "@/components/pipelines-console";

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
function stubFactory(overrides: Partial<Record<string, unknown>> = {}) {
  const defaults: Record<string, unknown> = {
    "/api/github/connections": { connections: [] },
    "/api/projects": { projects: [] },
    "/api/ai-accounts": { accounts: [] },
    "/api/bots": { bots: [], assignments: [] },
    "/api/commands": { commands: [] },
    "/api/project-pipelines": { pipelines: [], canManage: true },
  };
  const bodies = { ...defaults, ...overrides };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url in bodies) return jsonResponse(bodies[url]);
    return jsonResponse({});
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiFactoryConsole", () => {
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
    expect(screen.getByText("0 of 8 complete")).toBeInTheDocument();
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
      "/api/ai-accounts": { accounts: [{ status: "connected" }] },
      "/api/bots": {
        bots: [{ id: "b1" }],
        assignments: [{ id: "a1", projectId: "p1", roleId: "builder", status: "active" }],
      },
      "/api/commands": {
        commands: [{ id: "c1", prompt: "Ship search", status: "running", project: { id: "p1", name: "SoftwareFactory" } }],
      },
      "/api/project-pipelines": {
        pipelines: [{ id: "pp1", projectId: "p1", templateKey: "general_audit", name: "General Audit" }],
        canManage: true,
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    // Seven steps carry evidence; only "Watch It Ship" remains, because no
    // command has succeeded yet.
    expect(await screen.findByText("7 of 8 complete")).toBeInTheDocument();
    const watch = screen.getByText("Watch It Ship").closest("li") as HTMLElement;
    expect(within(watch).getByText("You are here")).toBeInTheDocument();
    expect(within(watch).getByText(/Work is in flight/)).toBeInTheDocument();

    fireEvent.click(within(watch).getByRole("button", { name: /watch execution/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Command execution, live")).toBeInTheDocument();
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

  it("returns to the journey on its own once the overlay's control completes", async () => {
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
    stubFactory({
      "/api/bots": {
        assignments: [
          { id: "a1", projectId: "p1", status: "active" },
          { id: "a2", projectId: "p1", roleId: "builder", status: "released" },
        ],
        bots: [{ id: "b1" }],
      },
      // An assignment names a project, so the project has to exist for the
      // fixture to describe a state the database could actually hold.
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const configure = (await screen.findByText("Configure Bot Settings")).closest("li") as HTMLElement;
    expect(within(configure).getByText(/none carries a role or responsibilities yet/)).toBeInTheDocument();
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

  it("fails closed for a signed-out visitor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    expect(await screen.findByText("Sign in to run your factory")).toBeInTheDocument();
  });
});

describe("Create New AI Factory", () => {
  const twoProjects = {
    "/api/bots": {
      assignments: [
        { projectId: "p1", responsibilities: ["ship"], roleId: "r1", status: "active" },
      ],
      bots: [{ id: "b1" }],
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
    expect(screen.getByText(/1 active assignment on this factory/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Create New AI Factory/i }));

    // Nothing was deleted: the steps are empty because the new factory has no
    // project yet, and the message says so rather than implying a wipe.
    await waitFor(() => {
      expect(screen.getByText(/Nothing was deleted/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/No project yet for this factory/)).toBeInTheDocument();
    expect(screen.getByText(/No bot is assigned to this factory yet/)).toBeInTheDocument();
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
});
