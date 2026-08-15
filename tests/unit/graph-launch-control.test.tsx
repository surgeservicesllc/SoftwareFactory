import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphLaunchControl } from "@/components/graph-launch-control";

/**
 * The control's job is to be truthful about what it did.
 *
 * The interesting assertions here are about wording, not wiring. A graph is
 * recorded and nothing is dispatched, so a surface that implied a run had
 * started would be the exact overclaim this phase keeps producing — and it would
 * be believed, because a spinner and a green badge are persuasive.
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
  note: "The graph is recorded. No node has been dispatched: no executor is connected to the graph runner, so nothing will run until one is.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the graph launch control", () => {
  it("records a graph and says plainly that nothing is running", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/projects")) return jsonResponse({ projects });
      if (url.includes("/api/graphs")) return jsonResponse(recorded);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<GraphLaunchControl templateKey="feature_build" templateName="Feature build" />);

    const select = await screen.findByLabelText("Project");
    await userEvent.selectOptions(select, projects[0].id);
    await userEvent.click(screen.getByRole("button", { name: /record feature build/i }));

    await waitFor(() => expect(screen.getByText("Recorded")).toBeInTheDocument());

    // The compiler's numbers reach the reader.
    expect(screen.getByText(/DIAMOND/)).toBeInTheDocument();
    expect(screen.getByText(/6 nodes/)).toBeInTheDocument();

    // The load-bearing sentence. Its absence is what would make this surface a
    // lie, so it is asserted rather than assumed to survive a refactor.
    expect(screen.getByText(/No node has been dispatched/)).toBeInTheDocument();

    // Nothing anywhere claims the graph is running.
    expect(screen.queryByText(/\brunning\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bstarted\b/i)).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: /record feature build/i }));

    // The write boundary went to the trouble of explaining itself; discarding
    // that for "something went wrong" wastes the only useful part.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("two nodes write the same resource");
  });

  it("distinguishes a failed project read from an account with no projects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "boom" }, 500)));

    render(<GraphLaunchControl templateKey="feature_build" templateName="Feature build" />);

    // A selector that silently showed nothing would report an outage as an
    // empty account, and send the reader to create a project they already have.
    expect(await screen.findByText("Projects could not be read")).toBeInTheDocument();
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
  });

  it("cannot record without choosing a project", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ projects })));

    render(<GraphLaunchControl templateKey="feature_build" templateName="Feature build" />);
    await screen.findByLabelText("Project");

    expect(screen.getByRole("button", { name: /record feature build/i })).toBeDisabled();
  });
});
