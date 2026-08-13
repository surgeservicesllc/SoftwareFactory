import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentsConsole } from "@/components/agents-console";
import { BacklogConsole } from "@/components/backlog-console";
import { CommandsConsole } from "@/components/commands-console";
import { RunsConsole } from "@/components/runs-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

beforeEach(() => {
  // The consoles skip the request entirely when the browser bundle has no
  // Supabase configuration, so these must be present to exercise fetching.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("live tenant consoles", () => {
  it("does not issue a request that can only fail when Supabase is unconfigured", async () => {
    vi.unstubAllEnvs();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentsConsole />);

    expect(await screen.findByText("Sign in to see your agents")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks a signed-out visitor to sign in rather than showing rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "unauthorized" } }, 401),
    ));

    render(<AgentsConsole />);

    expect(await screen.findByText("Sign in to see your agents")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/auth/sign-in?next=%2Fsolutions%2Fagents",
    );
  });

  it("sends a caller without an active organization to workspace setup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "organization_onboarding_required" } }, 409),
    ));

    render(<BacklogConsole />);

    expect(await screen.findByText("Choose a workspace")).toBeInTheDocument();
  });

  it("states that nothing exists yet instead of inventing example rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ runs: [] })));

    render(<RunsConsole />);

    expect(await screen.findByText("Nothing has run yet")).toBeInTheDocument();
    // The empty state must not be dressed up as data.
    expect(screen.queryByText(/Demo Data/i)).not.toBeInTheDocument();
  });

  it("surfaces the server's message when the read fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: "The backlog could not be loaded." } }, 500),
    ));

    render(<BacklogConsole />);

    expect(await screen.findByText("The backlog could not be loaded.")).toBeInTheDocument();
  });

  it("renders live rows with their risk and status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      tasks: [{
        id: "task-1",
        title: "Add project health aggregation",
        description: null,
        status: "backlog",
        risk: "green",
        requiresOwnerApproval: false,
        priority: 90,
        createdAt: "2026-08-12T10:00:00.000Z",
        project: { id: "project-1", name: "SoftwareFactory" },
        agent: null,
      }],
    })));

    render(<BacklogConsole />);

    expect(await screen.findByText("Add project health aggregation")).toBeInTheDocument();
    expect(screen.getByText("GREEN")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText(/SoftwareFactory/)).toBeInTheDocument();
  });

  it("flags a task that cannot proceed without owner approval", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      tasks: [{
        id: "task-red",
        title: "Rotate the signing key",
        description: null,
        status: "awaiting_approval",
        risk: "red",
        requiresOwnerApproval: true,
        priority: 100,
        createdAt: "2026-08-12T10:00:00.000Z",
        project: null,
        agent: null,
      }],
    })));

    render(<BacklogConsole />);

    expect(await screen.findByText(/needs your approval/)).toBeInTheDocument();
    expect(screen.getByText("RED")).toBeInTheDocument();
  });

  it("reloads saved requests when the composer reports a new one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ commands: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<CommandsConsole refreshToken={0} />);
    await screen.findByText("No requests yet");
    const initialCalls = fetchMock.mock.calls.length;

    rerender(<CommandsConsole refreshToken={1} />);

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls));
  });
});
