import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveDashboardMetrics } from "@/components/live-dashboard-metrics";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

describe("LiveDashboardMetrics", () => {
  it("does not present live counts to a signed-out visitor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<LiveDashboardMetrics authenticated={false} />);

    expect((await screen.findAllByText("Sign in required")).length).toBeGreaterThan(0);
    expect(screen.getByText("Connected projects").closest("article")).toHaveTextContent("—");
    expect(screen.queryByText("Demo Data")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not issue a failing request when local Supabase is unconfigured", async () => {
    vi.unstubAllEnvs();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<LiveDashboardMetrics authenticated />);

    expect((await screen.findAllByText("Sign in required")).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows tenant project and GitHub open-PR counts from their live sources", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") {
        return jsonResponse({
          connectedCount: 1,
          projects: [{ id: "project-1", githubRepository: "example/repository", defaultBranch: "main", connectionId: "connection-1", connectionStatus: "connected" }],
        });
      }
      return jsonResponse({
        pullRequests: [
          { id: 1, state: "open" },
          { id: 2, state: "open" },
          { id: 3, state: "closed" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LiveDashboardMetrics authenticated />);

    expect(await screen.findByText("Live · Supabase + GitHub")).toBeInTheDocument();
    expect(screen.getByText("Connected projects").closest("article")).toHaveTextContent("1");
    expect(screen.getByText("Open pull requests").closest("article")).toHaveTextContent("2");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/github/repositories/example/repository/pulls?connectionId=connection-1",
      { cache: "no-store" },
    );
  });

  it("withholds a partial PR total when any live GitHub source fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") {
        return jsonResponse({
          connectedCount: 2,
          projects: [
            { id: "project-1", githubRepository: "example/one", defaultBranch: "main", connectionId: "connection-1", connectionStatus: "connected" },
            { id: "project-2", githubRepository: "example/two", defaultBranch: "main", connectionId: "connection-2", connectionStatus: "connected" },
          ],
        });
      }
      if (url.includes("/example/one/")) return jsonResponse({ pullRequests: [{ id: 1, state: "open" }] });
      return jsonResponse({ error: { message: "GitHub rate limit reached." } }, 429);
    }));

    render(<LiveDashboardMetrics authenticated />);

    await screen.findByText("Live · Supabase + GitHub");
    await waitFor(() => expect(screen.getByText("Open pull requests").closest("article")).toHaveTextContent("Incomplete"));
    expect(screen.getByText("Open pull requests").closest("article")).toHaveTextContent("—");
    expect(screen.getByText(/1 live repository source is unavailable/)).toBeInTheDocument();
  });

  it("does not call a historically linked but Not Connected project live", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/projects") {
        return jsonResponse({
          connectedCount: 0,
          projects: [{
            id: "project-lost",
            githubRepository: "example/lost",
            defaultBranch: "main",
            connectionId: "connection-lost",
            connectionStatus: "not_connected",
          }],
        });
      }
      throw new Error("A lost project must not trigger GitHub reads.");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LiveDashboardMetrics authenticated />);

    expect(await screen.findByText(/Live .* Supabase .* GitHub Not Connected/)).toBeInTheDocument();
    expect(screen.getByText("Connected projects").closest("article")).toHaveTextContent("0");
    expect(screen.getByText("Open pull requests").closest("article")).toHaveTextContent("—");
    expect(screen.getByText("Open pull requests").closest("article")).toHaveTextContent("GitHub Not Connected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
