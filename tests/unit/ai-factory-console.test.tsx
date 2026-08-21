import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiFactoryConsole } from "@/components/ai-factory-console";
import type { PipelineTemplateSummary } from "@/components/pipelines-console";
import { LEAST_PRIVILEGE_CONFIG } from "@/lib/bots/assignment-config";

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
        // Configured means somebody moved this posting off the least-privilege
        // default. The fixture said only `roleId: "builder"`, which every
        // assignment has, and the step counted as done for that reason alone.
        assignments: [{
          id: "a1",
          projectId: "p1",
          roleId: "builder",
          status: "active",
          config: { ...LEAST_PRIVILEGE_CONFIG, responsibilities: ["Ship search"] },
        }],
        executor: { connected: true, label: "Connected", detail: "" },
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
    expect(within(dialog).getByText("Command execution")).toBeInTheDocument();
    expect(within(dialog).getByText("Connected")).toBeInTheDocument();
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
    // Every assignment carries a role: `bot_assignments.role_id` is NOT NULL,
    // so a fixture without one describes a record the database cannot hold.
    // This step used to be derived from `roleId || responsibilities.length` --
    // a field the payload nests under `config`, plus a column that is always
    // set -- so it was marked done the moment a bot was assigned and could
    // never read as outstanding. What counts is whether somebody moved the
    // posting off its least-privilege default.
    stubFactory({
      "/api/bots": {
        assignments: [
          { id: "a1", projectId: "p1", roleId: "role-1", status: "active", config: LEAST_PRIVILEGE_CONFIG },
          { id: "a2", projectId: "p1", roleId: "role-1", status: "released", config: { ...LEAST_PRIVILEGE_CONFIG, preset: "builder" } },
        ],
        bots: [{ id: "b1" }],
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
      "/api/bots": {
        assignments: [
          {
            id: "a1",
            projectId: "p1",
            roleId: "role-1",
            status: "active",
            config: { ...LEAST_PRIVILEGE_CONFIG, responsibilities: ["Review migrations"] },
          },
        ],
        bots: [{ id: "b1" }],
      },
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const configure = (await screen.findByText("Configure Bot Settings")).closest("li") as HTMLElement;
    expect(within(configure).getByText(/1 of 1 assignment configured/)).toBeInTheDocument();
  });

  it("opens the roster on the factory the journey is showing, not the first project", async () => {
    // With two projects these differ: the roster fell back to `projects[0]`
    // while the steps counted the active factory, so a person sent to
    // "Assign Bots" configured one project while the step measured another.
    stubFactory({
      "/api/projects": {
        projects: [
          { id: "p1", name: "First Project" },
          { id: "p2", name: "Second Project" },
        ],
      },
      "/api/bots": { bots: [{ id: "b1" }], assignments: [] },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    // Pick the second project as the factory being built.
    const picker = await screen.findByLabelText("Factory");
    fireEvent.change(picker, { target: { value: "p2" } });

    const assign = (await screen.findByText("Assign Bots to Project")).closest("li") as HTMLElement;
    fireEvent.click(within(assign).getByRole("button", { name: /assign a bot|assign/i }));

    const dialog = await screen.findByRole("dialog");
    const rosterPicker = within(dialog).getByLabelText("Project") as HTMLSelectElement;
    expect(rosterPicker.value).toBe("p2");
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
    expect(await screen.findByText("1 of 8 complete")).toBeInTheDocument();
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
        executor: {
          connected: false,
          label: "Not Connected",
          detail: "No worker executes them in this phase.",
        },
      },
      "/api/commands": {
        commands: [{ id: "c1", prompt: "Ship search", status: "queued", project: { id: "p1", name: "SoftwareFactory" } }],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const watch = (await screen.findByText("Watch It Ship")).closest("li") as HTMLElement;
    expect(within(watch).getByText(/the executor is Not Connected/)).toBeInTheDocument();
    expect(within(watch).queryByText(/Work is in flight/)).not.toBeInTheDocument();
    expect(within(watch).getByText(/When an executor is connected/)).toBeInTheDocument();

    fireEvent.click(within(watch).getByRole("button", { name: /watch execution/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Not Connected")).toBeInTheDocument();
    expect(within(dialog).getByText(/will not start until an executor is connected/)).toBeInTheDocument();
  });

  it("treats a missing executor field as Not Connected", async () => {
    // Absent must never read as connected: an older payload, a partial
    // response, or a failed read all land here.
    stubFactory({
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/bots": { bots: [{ id: "b1" }], assignments: [] },
      "/api/commands": {
        commands: [{ id: "c1", prompt: "Ship search", status: "queued", project: { id: "p1", name: "SoftwareFactory" } }],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);
    const watch = (await screen.findByText("Watch It Ship")).closest("li") as HTMLElement;
    expect(within(watch).getByText(/the executor is Not Connected/)).toBeInTheDocument();
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
