import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisionOverview } from "@/components/decision-overview";

vi.mock("@/lib/supabase/browser-config", () => ({
  isBrowserSupabaseConfigured: () => true,
}));

/**
 * The chooser's right rail.
 *
 * The point of the card is that its numbers are counted, not estimated, so
 * what is worth asserting is the failure behaviour: a source that cannot be
 * read says so on its own row instead of rendering a confident zero, and one
 * failed source never blanks the two that succeeded.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function project(connected: boolean) {
  return {
    githubRepository: connected ? "owner/repository" : null,
    connectionId: connected ? "connection-1" : null,
    connectionStatus: connected ? "connected" : "not_connected",
  };
}

function row(label: string) {
  const link = screen.getByRole("link", { name: label });
  const listItem = link.closest("li");
  if (!listItem) throw new Error(`no row for ${label}`);
  return within(listItem);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DecisionOverview", () => {
  it("counts projects, pipelines and bots from the tenant endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/projects")) {
        return jsonResponse({ projects: [project(true), project(true), project(false)] });
      }
      if (url.startsWith("/api/commands")) {
        return jsonResponse({
          commands: [
            { status: "running" },
            { status: "queued" },
            { status: "succeeded" },
            { status: "cancelled" },
          ],
        });
      }
      return jsonResponse({ bots: [{ id: "bot-1" }] });
    }));

    render(<DecisionOverview authenticated />);

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(row("Projects").getByText("2 connected to a repository")).toBeInTheDocument();

    // Terminal statuses are not "in flight"; the other two are.
    expect(row("Pipelines").getByText("4")).toBeInTheDocument();
    expect(row("Pipelines").getByText("2 in flight")).toBeInTheDocument();
    expect(row("Bots").getByText("1")).toBeInTheDocument();
  });

  it("says a source is unavailable rather than reporting it as zero", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/projects")) return jsonResponse({ projects: [project(true)] });
      if (url.startsWith("/api/commands")) return jsonResponse({ error: {} }, 503);
      return jsonResponse({ bots: [] });
    }));

    render(<DecisionOverview authenticated />);

    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    // The one that failed is the only one that lost its number.
    expect(row("Pipelines").getByText("Unavailable")).toBeInTheDocument();
    expect(row("Projects").getByText("1")).toBeInTheDocument();
    expect(row("Bots").getByText("0")).toBeInTheDocument();
  });

  it("names the two cases that are not failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: {} }, 409)));
    const { unmount } = render(<DecisionOverview authenticated />);
    expect(await screen.findByText(/Name a workspace/)).toBeInTheDocument();
    unmount();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: {} }, 401)));
    render(<DecisionOverview authenticated />);
    expect(await screen.findByText(/Sign in to see your workspace/)).toBeInTheDocument();
  });

  it("re-reads on request rather than making the person reload the page", async () => {
    let projectCount = 1;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/projects")) {
        return jsonResponse({ projects: Array.from({ length: projectCount }, () => project(true)) });
      }
      if (url.startsWith("/api/commands")) return jsonResponse({ commands: [] });
      return jsonResponse({ bots: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DecisionOverview authenticated />);
    expect(await screen.findByText("1")).toBeInTheDocument();

    projectCount = 4;
    await userEvent.click(screen.getByRole("button", { name: "Refresh the quick overview" }));
    expect(await screen.findByText("4")).toBeInTheDocument();
  });

  it("asks for nothing at all when there is no session to ask with", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<DecisionOverview authenticated={false} />);

    expect(screen.getByText(/Sign in to see your workspace/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
