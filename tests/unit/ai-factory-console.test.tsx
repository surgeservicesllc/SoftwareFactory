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
        assignments: [{ id: "a1", status: "active", roleId: "builder" }],
      },
      "/api/commands": {
        commands: [{ id: "c1", prompt: "Ship search", status: "running", project: { id: "p1", name: "SoftwareFactory" } }],
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
        bots: [{ id: "b1" }],
        assignments: [
          { id: "a1", status: "active" },
          { id: "a2", status: "released", roleId: "builder" },
        ],
      },
    });

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    const configure = (await screen.findByText("Configure Bot Settings")).closest("li") as HTMLElement;
    expect(within(configure).getByText(/none carries a role or responsibilities yet/)).toBeInTheDocument();
  });

  it("fails closed for a signed-out visitor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));

    render(<AiFactoryConsole builtIns={BUILT_INS} />);

    expect(await screen.findByText("Sign in to run your factory")).toBeInTheDocument();
  });
});
