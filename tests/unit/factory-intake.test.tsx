import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FactoryIntake } from "@/components/factory-intake";

/**
 * The one-request front door.
 *
 * Two things matter more than the happy path here. The sentence must reach the
 * database as the person typed it — `graphs.goal` is what every downstream
 * surface shows as "what this run is for" — and the reply must not say the run
 * started, because it has not: planning a graph and dispatching one are
 * different acts, and the second needs a credential this repository does not
 * have.
 */

function respond(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const PROJECTS = { projects: [{ id: "p-1", name: "Trading platform" }, { id: "p-2", name: "Site" }] };

const PLANNED = {
  graphId: "g-1",
  goal: "Add world-class backtesting to my trading platform.",
  nodeCount: 19,
  maxParallelism: 3,
  isLifecycle: true,
  state: "PLANNED",
  note: "The graph is recorded. No node has been dispatched yet.",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the request intake", () => {
  it("sends the sentence verbatim, with the lifecycle template", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/projects") ? respond(PROJECTS) : respond({ ...PLANNED, init }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FactoryIntake />);

    const goal = await screen.findByLabelText("What do you want built?");
    await user.type(goal, "Add world-class backtesting to my trading platform.");
    await user.click(screen.getByRole("button", { name: /start the lifecycle/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/graphs", expect.objectContaining({
        method: "POST",
      }));
    });
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/graphs");
    expect(JSON.parse(String(call![1]?.body))).toEqual({
      projectId: "p-1",
      templateKey: "agentic_sdlc",
      goal: "Add world-class backtesting to my trading platform.",
    });
  });

  it("says the graph is planned, not that the run started", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).startsWith("/api/projects") ? respond(PROJECTS) : respond(PLANNED)));
    render(<FactoryIntake />);

    await user.type(
      await screen.findByLabelText("What do you want built?"),
      "Add backtesting.",
    );
    await user.click(screen.getByRole("button", { name: /start the lifecycle/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("No node has been dispatched yet");
    expect(status).toHaveTextContent("19 nodes across 10 stages, up to 3 running at once.");
    expect(screen.queryByText(/your run has started/i)).not.toBeInTheDocument();
  });

  it("shows what the database recorded, which can differ from what was sent", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).startsWith("/api/projects")
        ? respond(PROJECTS)
        : respond({ ...PLANNED, goal: "Add world-class backtesting to my trading platform." })));
    render(<FactoryIntake />);

    await user.type(await screen.findByLabelText("What do you want built?"), "Add backtesting.");
    await user.click(screen.getByRole("button", { name: /start the lifecycle/i }));

    expect(await screen.findByRole("status"))
      .toHaveTextContent("Recorded: Add world-class backtesting to my trading platform.");
  });

  it("hands the reader straight to the first stage", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).startsWith("/api/projects") ? respond(PROJECTS) : respond(PLANNED)));
    render(<FactoryIntake />);

    await user.type(await screen.findByLabelText("What do you want built?"), "Add backtesting.");
    await user.click(screen.getByRole("button", { name: /start the lifecycle/i }));

    expect(await screen.findByRole("link", { name: /open 1 requirement/i }))
      .toHaveAttribute("href", "/solutions/factory/requirement");
  });

  it("lets a person choose which project the run belongs to", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/projects") ? respond(PROJECTS) : respond({ ...PLANNED, init }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FactoryIntake />);

    await user.selectOptions(await screen.findByLabelText("Project"), "p-2");
    await user.type(await screen.findByLabelText("What do you want built?"), "Add backtesting.");
    await user.click(screen.getByRole("button", { name: /start the lifecycle/i }));

    const call = fetchMock.mock.calls.find(([url]) => url === "/api/graphs");
    expect(JSON.parse(String(call![1]?.body)).projectId).toBe("p-2");
  });

  it("will not submit an empty request", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond(PROJECTS)));
    render(<FactoryIntake />);

    expect(await screen.findByRole("button", { name: /start the lifecycle/i })).toBeDisabled();
  });

  it("passes the compiler's refusal through instead of a friendlier sentence", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).startsWith("/api/projects")
        ? respond(PROJECTS)
        : respond({
          error: {
            message: "The template could not be compiled into a graph.",
            details: ["Feedback edge decide -> evaluate_matrix runs forwards."],
          },
        }, 422)));
    render(<FactoryIntake />);

    await user.type(await screen.findByLabelText("What do you want built?"), "Add backtesting.");
    await user.click(screen.getByRole("button", { name: /start the lifecycle/i }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Feedback edge decide -> evaluate_matrix runs forwards.");
  });

  it("says a run needs a project when there is none, rather than offering an empty picker", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({ projects: [] })));
    render(<FactoryIntake />);

    expect(await screen.findByText(/there is no project to attach one to yet/))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start the lifecycle/i })).not.toBeInTheDocument();
  });

  it("sends someone signed out to sign in", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({}, 401)));
    render(<FactoryIntake />);

    expect(await screen.findByRole("link", { name: "Sign in" }))
      .toHaveAttribute("href", "/auth/sign-in");
  });

  it("sends an unfinished organization to onboarding", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({}, 409)));
    render(<FactoryIntake />);

    expect(await screen.findByRole("link", { name: /finish setting up your organization/i }))
      .toHaveAttribute("href", "/auth/onboarding");
  });
});
