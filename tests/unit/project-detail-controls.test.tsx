// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDetailConsole } from "@/components/project-detail-console";
import { buildPortfolio } from "@/lib/portfolio/aggregate";
import type { ProjectRow } from "@/lib/portfolio/aggregate";

/**
 * The project detail page is where a project is operated, so what matters is
 * not that the controls render — it is what they send and what they refuse to
 * send.
 *
 * Three things are asserted throughout: the two lifecycle words mean different
 * things and hit different actions, a destructive action cannot be fired
 * without a reason, and a refusal from the database is shown verbatim rather
 * than replaced with a friendlier sentence that would hide why it failed.
 */

const projectId = "20000000-0000-4000-8000-0000000004a1";

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    autonomousMode: false,
    defaultBranch: "main",
    description: "The storefront customers actually use.",
    engineeringPaused: false,
    engineeringPauseReason: null,
    engineeringPriority: 2,
    githubRepository: "surgeservicesllc/storefront",
    healthStatus: "healthy",
    id: projectId,
    maximumAutonomousRisk: "GREEN",
    name: "Storefront",
    productionUrl: "https://storefront.example",
    status: "active",
    strategicFocus: false,
    ...overrides,
  };
}

function portfolioBody(overrides: Partial<ProjectRow> = {}) {
  return {
    portfolio: buildPortfolio({
      changeRequests: [],
      commands: [],
      connections: [{ projectId, provider: "github", status: "connected" }],
      deployments: [],
      incidents: [],
      projects: [projectRow(overrides)],
      runs: [],
      tasks: [],
    }),
  };
}

/** Records every non-GET request so the assertions can read the real payload. */
function mockFetch(overrides: Partial<ProjectRow> = {}, controlResponse?: Response) {
  const calls: { body: unknown; method: string; url: string }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null, method, url });
      return controlResponse ?? new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify(portfolioBody(overrides)), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("project detail controls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the project without inventing a count it was not given", async () => {
    mockFetch();
    render(<ProjectDetailConsole projectId={projectId} />);

    expect(await screen.findByRole("heading", { name: "Storefront" })).toBeTruthy();
    // Every source was readable and empty, so these are real zeros. The
    // Unknown path is covered by the aggregate's own tests.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    // The label appears twice by design — once as the recorded fact and once as
    // the selected option — so this asserts the control's value rather than a
    // string that legitimately occurs more than once.
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("2");
  });

  it("stops engineering with a reason, and will not stop without one", async () => {
    const calls = mockFetch();
    const user = userEvent.setup();
    render(<ProjectDetailConsole projectId={projectId} />);
    await screen.findByRole("heading", { name: "Storefront" });

    const stop = screen.getByRole("button", { name: /stop engineering/i });
    // The database requires a reason; the button refuses before the round trip
    // so the refusal is immediate rather than a server error.
    expect((stop as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByPlaceholderText(/why work is being held back/i), "Release freeze");
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    await user.click(stop);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toContain("/api/portfolio/controls");
    expect(calls[0].body).toEqual({
      action: "set_pause",
      paused: true,
      projectId,
      reason: "Release freeze",
    });
  });

  it("cancels only behind a confirmation and a reason, and archives rather than deletes", async () => {
    const calls = mockFetch();
    const user = userEvent.setup();
    render(<ProjectDetailConsole projectId={projectId} />);
    await screen.findByRole("heading", { name: "Storefront" });

    await user.click(screen.getByRole("button", { name: /^cancel project$/i }));
    const confirm = screen.getAllByRole("button", { name: /^cancel project$/i })
      .find((button) => (button as HTMLButtonElement).classList.contains("btn-danger"))!;
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(
      screen.getByPlaceholderText(/why this project is being cancelled/i),
      "Superseded by the new storefront",
    );
    await user.click(confirm);

    await waitFor(() => expect(calls).toHaveLength(1));
    // Archive, not delete. The whole point of the word "cancel" here is that
    // the history survives it.
    expect(calls[0].body).toEqual({
      action: "archive",
      projectId,
      reason: "Superseded by the new storefront",
    });
  });

  it("offers resume and restore instead once the project is stopped and cancelled", async () => {
    mockFetch({
      engineeringPauseReason: "Release freeze",
      engineeringPaused: true,
      status: "archived",
    });
    render(<ProjectDetailConsole projectId={projectId} />);
    await screen.findByRole("heading", { name: "Storefront" });

    expect(screen.getByRole("button", { name: /resume engineering/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /restore project/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^stop engineering$/i })).toBeNull();
    // The reason for the stop is shown, not just the fact of it.
    expect(screen.getByText(/Release freeze/)).toBeTruthy();
  });

  it("saves edited details through the project route", async () => {
    const calls = mockFetch();
    const user = userEvent.setup();
    render(<ProjectDetailConsole projectId={projectId} />);
    await screen.findByRole("heading", { name: "Storefront" });

    await user.click(screen.getByRole("button", { name: /edit details/i }));
    const name = screen.getByDisplayValue("Storefront");
    await user.clear(name);
    await user.type(name, "Storefront web");
    await user.click(screen.getByRole("button", { name: /save details/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain(`/api/projects/${projectId}`);
    expect(calls[0].body).toMatchObject({ name: "Storefront web" });
  });

  it("shows the database's refusal word for word", async () => {
    mockFetch(
      {},
      new Response(
        JSON.stringify({
          error: { message: "only an organization owner may pause or resume project engineering" },
        }),
        { status: 403 },
      ),
    );
    const user = userEvent.setup();
    render(<ProjectDetailConsole projectId={projectId} />);
    await screen.findByRole("heading", { name: "Storefront" });

    await user.type(screen.getByPlaceholderText(/why work is being held back/i), "Trying anyway");
    await user.click(screen.getByRole("button", { name: /stop engineering/i }));

    // Not "something went wrong": a non-owner is told exactly what the rule is,
    // which is the difference between a dead end and an explanation.
    expect(
      await screen.findByText(/only an organization owner may pause or resume/i),
    ).toBeTruthy();
  });

  it("changes priority without asking for a confirmation it does not need", async () => {
    const calls = mockFetch();
    const user = userEvent.setup();
    render(<ProjectDetailConsole projectId={projectId} />);
    await screen.findByRole("heading", { name: "Storefront" });

    await user.selectOptions(screen.getByRole("combobox"), "1");

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ action: "set_priority", priority: 1, projectId });
  });
});
