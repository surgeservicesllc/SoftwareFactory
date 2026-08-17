// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MyProjectsConsole } from "@/components/my-projects-console";

/**
 * Editing and archiving projects from the My Projects list, one at a time and
 * several at once.
 *
 * The interesting assertions are about the bulk path, because that is where a
 * plausible implementation goes wrong quietly: it sends one request and reports
 * one outcome, so a project that was refused looks archived. These tests pin
 * the opposite — one owner-gated call per project, and a per-project result
 * when they do not all agree.
 *
 * "Delete" is archive throughout, and not as a euphemism: `refuse_project_
 * deletion` states the rule the schema has enforced since a project's first
 * moment, so a hard delete is not a thing this UI could offer even if it said
 * the word.
 */

const projects = [
  {
    autonomousMode: false,
    connectionId: "c1",
    connectionStatus: "connected" as const,
    defaultBranch: "main",
    description: "The storefront customers use.",
    githubRepository: "surgeservicesllc/storefront",
    githubRepositoryId: 1,
    healthStatus: "healthy",
    id: "p1",
    maximumAutonomousRisk: "green",
    name: "Storefront",
    status: "active",
  },
  {
    autonomousMode: false,
    connectionId: "c1",
    connectionStatus: "connected" as const,
    defaultBranch: "main",
    description: null,
    githubRepository: "surgeservicesllc/admin",
    githubRepositoryId: 2,
    healthStatus: "unknown",
    id: "p2",
    maximumAutonomousRisk: "green",
    name: "Admin",
    status: "active",
  },
];

/** Records every mutation so the assertions can read the real payloads. */
function mockFetch(controlResponder?: (body: Record<string, unknown>) => Response) {
  const calls: { body: Record<string, unknown>; url: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? "GET") !== "GET") {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ body, url });
      return controlResponder?.(body)
        ?? new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.startsWith("/api/projects")) {
      return new Response(JSON.stringify({ projects }), { status: 200 });
    }
    if (url.startsWith("/api/github/connections")) {
      return new Response(JSON.stringify({ connections: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }));
  return calls;
}

async function renderList() {
  render(<MyProjectsConsole />);
  await screen.findByRole("button", { name: /^Edit Storefront$/ });
}

describe("editing and archiving from My Projects", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("offers edit and archive on the row, without expanding it first", async () => {
    mockFetch();
    await renderList();

    // Acting on a project should not require reading it first, which is what
    // burying these inside the disclosure amounted to.
    for (const name of ["Storefront", "Admin"]) {
      expect(screen.getByRole("button", { name: `Edit ${name}` })).toBeTruthy();
      expect(screen.getByRole("button", { name: `Archive ${name}` })).toBeTruthy();
    }
  });

  it("archives one project through the owner-gated control, with its reason", async () => {
    const calls = mockFetch();
    const user = userEvent.setup();
    await renderList();

    await user.click(screen.getByRole("button", { name: "Archive Admin" }));
    await user.type(screen.getByLabelText(/why archive it/i), "Folded into Storefront");
    await user.click(screen.getByRole("button", { name: /archive project/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toContain("/api/portfolio/controls");
    expect(calls[0].body).toEqual({
      action: "archive",
      projectId: "p2",
      reason: "Folded into Storefront",
    });
  });

  it("selects every project and archives them one call each", async () => {
    const calls = mockFetch();
    const user = userEvent.setup();
    await renderList();

    await user.click(screen.getByRole("checkbox", { name: /select all projects/i }));
    await user.click(screen.getByRole("button", { name: /archive 2 projects/i }));
    await user.type(screen.getByLabelText(/why archive them/i), "Consolidated");
    await user.click(screen.getByRole("button", { name: /^Archive 2$/ }));

    // One owner-gated call per project, not a bulk endpoint that would have to
    // invent a meaning for "partly succeeded".
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((call) => call.body.projectId).sort()).toEqual(["p1", "p2"]);
    expect(calls.every((call) => call.body.reason === "Consolidated")).toBe(true);
    expect(calls.every((call) => call.url.includes("/api/portfolio/controls"))).toBe(true);
  });

  it("names the project that was refused instead of reporting a bare failure", async () => {
    mockFetch((body) => body.projectId === "p2"
      ? new Response(
        JSON.stringify({ error: { message: "only an organization owner may archive a project" } }),
        { status: 403 },
      )
      : new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const user = userEvent.setup();
    await renderList();

    await user.click(screen.getByRole("checkbox", { name: /select all projects/i }));
    await user.click(screen.getByRole("button", { name: /archive 2 projects/i }));
    await user.type(screen.getByLabelText(/why archive them/i), "Consolidated");
    await user.click(screen.getByRole("button", { name: /^Archive 2$/ }));

    // The count is honest about the split, and the failure names which one and
    // why — a single "some failed" would hide both.
    expect(await screen.findByText(/Archived 1 of 2/)).toBeTruthy();
    // Scoped to the dialog: the project's name also appears in the row behind
    // it, and the point is that the *result* names which one was refused.
    const result = screen.getByRole("dialog");
    expect(within(result).getByText("Admin")).toBeTruthy();
    expect(within(result).getByText(/only an organization owner may archive/)).toBeTruthy();
  });

  it("will not archive without a reason, or with nothing selected", async () => {
    mockFetch();
    const user = userEvent.setup();
    await renderList();

    // Nothing selected: the bulk action is unavailable rather than a no-op.
    const bulk = screen.getByRole("button", { name: /archive selected/i });
    expect((bulk as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: /select Storefront/i }));
    await user.click(screen.getByRole("button", { name: /archive selected/i }));
    const confirm = screen.getByRole("button", { name: /^Archive 1$/ });
    // The reason is recorded against every project's audit trail, so it is
    // required here exactly as it is for a single archive.
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits a project's details through the project route", async () => {
    const calls = mockFetch();
    const user = userEvent.setup();
    await renderList();

    await user.click(screen.getByRole("button", { name: "Edit Storefront" }));
    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByDisplayValue("Storefront");
    await user.clear(name);
    await user.type(name, "Storefront web");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toContain("/api/projects/p1");
    expect(calls[0].body).toMatchObject({ name: "Storefront web" });
  });

  it("sets one priority across every selected project, one call each", async () => {
    const calls = mockFetch();
    const user = userEvent.setup();
    await renderList();

    await user.click(screen.getByRole("checkbox", { name: /select all projects/i }));
    await user.click(screen.getByRole("button", { name: /set priority/i }));
    await user.selectOptions(screen.getByLabelText(/^priority$/i), "1");
    await user.click(screen.getByRole("button", { name: /set p1 on 2/i }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((call) => call.body.projectId).sort()).toEqual(["p1", "p2"]);
    expect(calls.every((call) => call.body.action === "set_priority")).toBe(true);
    expect(calls.every((call) => call.body.priority === 1)).toBe(true);
  });

  it("offers bulk priority but not bulk renaming", async () => {
    mockFetch();
    const user = userEvent.setup();
    await renderList();

    await user.click(screen.getByRole("checkbox", { name: /select all projects/i }));

    // Priority exists to rank projects against each other, so a selection can
    // share one. A name is identity — giving five projects the same one is not
    // a feature — so editing stays per-project, and there is no bulk edit
    // button offering otherwise.
    expect(screen.getByRole("button", { name: /set priority/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /edit 2 projects/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /rename/i })).toBeNull();
  });

  it("says archiving keeps everything, because deletion is not available at all", async () => {
    mockFetch();
    const user = userEvent.setup();
    await renderList();

    await user.click(screen.getByRole("checkbox", { name: /select all projects/i }));
    await user.click(screen.getByRole("button", { name: /archive 2 projects/i }));

    // The copy has to carry this: a person looking for "delete" needs to know
    // why they are being offered archive, not be quietly given a synonym.
    expect(screen.getByText(/projects cannot be deleted/i)).toBeTruthy();
    expect(screen.getByText(/can be unarchived/i)).toBeTruthy();
  });
});
