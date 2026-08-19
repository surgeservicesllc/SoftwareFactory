import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityConsole } from "@/components/activity-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const liveEvent = {
  actor: { displayName: "@octo-actor", id: null, source: "github" },
  description: "GitHub pull request changed",
  entity: { id: "11111111-1111-4111-8111-111111111111", type: "github_webhook_delivery" },
  eventType: "project.updated",
  evidence: {
    action: "opened",
    conclusion: "success",
    resources: [{ id: "example/application", type: "repository" }],
    source: "github",
    stateTransition: "applied",
    status: "completed",
  },
  id: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-08-12T20:00:00.000Z",
  project: { id: "33333333-3333-4333-8333-333333333333", name: "Application" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ActivityConsole", () => {
  it("shows actor, source, entity id, resource id, and safe status evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ events: [liveEvent] })));

    render(<ActivityConsole />);

    expect(await screen.findByText("GitHub pull request changed")).toBeInTheDocument();
    expect(screen.getByText(/@octo-actor/)).toBeInTheDocument();
    expect(screen.getByText("Source:")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("11111111-1111-4111-8111-111111111111")).toBeInTheDocument();
    expect(screen.getByText("example/application")).toBeInTheDocument();
    expect(screen.getByText("opened")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.getByText("applied")).toBeInTheDocument();
  });

  it("aggregates the feed by project and filters on a selected facet", async () => {
    const gatewayEvent = {
      ...liveEvent,
      description: "Gateway run completed",
      id: "44444444-4444-4444-8444-444444444444",
      project: { id: "55555555-5555-4555-8555-555555555555", name: "Gateway" },
    };
    const organizationEvent = {
      ...liveEvent,
      description: "Organization member invited",
      id: "66666666-6666-4666-8666-666666666666",
      project: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ events: [liveEvent, gatewayEvent, organizationEvent] }),
    ));
    const user = userEvent.setup();

    render(<ActivityConsole />);

    // Every project that produced events appears as a facet with its count;
    // events with no project get an organization-level bucket, not a guess.
    const facets = await screen.findByRole("group", { name: "Filter activity by project" });
    expect(facets).toHaveTextContent("All (3)");
    expect(facets).toHaveTextContent("Application (1)");
    expect(facets).toHaveTextContent("Gateway (1)");
    expect(facets).toHaveTextContent("Organization (1)");

    await user.click(screen.getByRole("button", { name: "Gateway (1)" }));
    expect(screen.getByText("Gateway run completed")).toBeInTheDocument();
    expect(screen.queryByText("GitHub pull request changed")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization member invited")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All (3)" }));
    expect(screen.getByText("GitHub pull request changed")).toBeInTheDocument();
    expect(screen.getByText("Gateway run completed")).toBeInTheDocument();
    expect(screen.getByText("Organization member invited")).toBeInTheDocument();
  });

  it("shows a truthful empty state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ events: [] })));

    render(<ActivityConsole />);

    expect(await screen.findByText("Nothing has happened yet")).toBeInTheDocument();
    expect(screen.queryByText("GitHub pull request changed")).not.toBeInTheDocument();
  });

  it("offers a working retry after a redacted API error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Live activity could not be loaded." } }, 503))
      .mockResolvedValueOnce(jsonResponse({ events: [liveEvent] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ActivityConsole />);

    expect(await screen.findByRole("heading", { name: "Activity is unavailable" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("GitHub pull request changed")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
