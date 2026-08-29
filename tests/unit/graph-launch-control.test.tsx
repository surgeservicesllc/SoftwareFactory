import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphLaunchControl } from "@/components/graph-launch-control";

/**
 * The control's job is to be truthful about what it did.
 *
 * The interesting assertions here are about wording, not wiring. A launch
 * records the graph and wakes the worker best-effort; whether the wake happened
 * is the server's sentence to say, so the control must render that sentence
 * verbatim and never claim on its own authority that work is running — a
 * spinner and a green badge are persuasive, which is exactly the danger.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const projects = [{ id: "40000000-0000-4000-8000-000000000001", name: "Storefront" }];

const recorded = {
  graphId: "70000000-0000-4000-8000-0000000000aa",
  topology: "DIAMOND",
  nodeCount: 6,
  edgeCount: 7,
  maxParallelism: 3,
  requiresOwnerApproval: false,
  workerWoken: true,
  note: "The graph is recorded and the executor worker has been woken to claim it.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the graph launch control", () => {
  it("records a graph and renders the server's own sentence about the wake", async () => {
    const onLaunched = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/projects")) return jsonResponse({ projects });
      if (url.includes("/api/graphs")) return jsonResponse(recorded);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GraphLaunchControl
        templateKey="feature_build"
        templateName="Feature build"
        onLaunched={onLaunched}
      />,
    );

    const select = await screen.findByLabelText("Project");
    await userEvent.selectOptions(select, projects[0].id);
    await userEvent.type(screen.getByLabelText("Goal"), "Fix checkout failures without changing auth.");
    await userEvent.click(screen.getByRole("button", { name: /launch feature build/i }));

    await waitFor(() => expect(screen.getByText("Recorded")).toBeInTheDocument());

    // The compiler's numbers reach the reader.
    expect(screen.getByText(/DIAMOND/)).toBeInTheDocument();
    expect(screen.getByText(/6 nodes/)).toBeInTheDocument();

    // The load-bearing sentence is the server's, verbatim. A paraphrase here
    // is how the control would drift from what actually happened.
    expect(screen.getByText(/executor worker has been woken/)).toBeInTheDocument();

    // The control itself still never claims the graph is running — the wake is
    // an invitation to claim, not a run in progress.
    expect(screen.queryByText(/\brunning\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bstarted\b/i)).not.toBeInTheDocument();

    const launchRequest = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/graphs"));
    expect(JSON.parse(String(launchRequest?.[1]?.body))).toEqual({
      projectId: projects[0].id,
      templateKey: "feature_build",
      goal: "Fix checkout failures without changing auth.",
    });
    expect(onLaunched).toHaveBeenCalledOnce();
    expect(onLaunched).toHaveBeenCalledWith({ ...recorded, projectId: projects[0].id });
  });

  it("shows the server's own refusal rather than a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/projects")) return jsonResponse({ projects });
        return jsonResponse(
          {
            error: {
              code: "template_does_not_compile",
              message: "The template could not be compiled into a graph.",
              details: ["two nodes write the same resource"],
            },
          },
          422,
        );
      }),
    );

    render(<GraphLaunchControl templateKey="feature_build" templateName="Feature build" />);
    await userEvent.selectOptions(await screen.findByLabelText("Project"), projects[0].id);
    await userEvent.type(screen.getByLabelText("Goal"), "Resolve the checkout failures.");
    await userEvent.click(screen.getByRole("button", { name: /launch feature build/i }));

    // The write boundary went to the trouble of explaining itself; discarding
    // that for "something went wrong" wastes the only useful part.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("two nodes write the same resource");
  });

  it("distinguishes a failed project read from an account with no projects, and shows the server's reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { message: "row-level security refused the read" } }, 500),
      ),
    );

    render(<GraphLaunchControl templateKey="feature_build" templateName="Feature build" />);

    // A selector that silently showed nothing would report an outage as an
    // empty account, and send the reader to create a project they already have.
    expect(await screen.findByText("Projects could not be read")).toBeInTheDocument();
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
    // The server's own sentence, so the failure is diagnosable from the page.
    expect(screen.getByText(/row-level security refused the read/)).toBeInTheDocument();
  });

  it("cannot record without choosing a project", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ projects })));

    render(<GraphLaunchControl templateKey="feature_build" templateName="Feature build" />);
    await screen.findByLabelText("Project");

    expect(screen.getByRole("button", { name: /launch feature build/i })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Project"), projects[0].id);
    expect(screen.getByRole("button", { name: /launch feature build/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Goal"), "Build the requested feature.");
    expect(screen.getByRole("button", { name: /launch feature build/i })).toBeEnabled();
  });
});
