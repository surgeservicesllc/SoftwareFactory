import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NeedsYourAttention } from "@/components/needs-your-attention";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

/** Stub the five decision sources; unset ones default to all-clear. */
function stubSources(sources: {
  commands?: unknown;
  commandsStatus?: number;
  connections?: unknown;
  connectionsStatus?: number;
  worker?: unknown;
  operations?: unknown;
  operationsStatus?: number;
  runs?: unknown;
  runsStatus?: number;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/commands") {
      return jsonResponse(sources.commands ?? { commands: [] }, sources.commandsStatus ?? 200);
    }
    if (url === "/api/github/connections") {
      return jsonResponse(sources.connections ?? { connections: [] }, sources.connectionsStatus ?? 200);
    }
    if (url === "/api/worker/status") {
      return jsonResponse(sources.worker ?? { worker: { connectionStatus: "connected" } });
    }
    if (url === "/api/operations/overview") {
      return jsonResponse(sources.operations ?? { incidents: [] }, sources.operationsStatus ?? 200);
    }
    if (url === "/api/runs") {
      return jsonResponse(sources.runs ?? { runs: [] }, sources.runsStatus ?? 200);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

describe("NeedsYourAttention", () => {
  it("renders nothing at all when there is nothing to decide", async () => {
    const fetchMock = stubSources({});

    const { container } = render(<NeedsYourAttention authenticated />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // No empty shell, no zero-count banner: silence is the default state.
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing and fetches nothing for a signed-out visitor", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NeedsYourAttention authenticated={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a command awaiting approval with what, why, and one action", async () => {
    stubSources({
      commands: {
        commands: [
          { id: "c-1", prompt: "Rotate the production keys", risk: "red", status: "awaiting_approval" },
          { id: "c-2", prompt: "Routine audit", risk: "green", status: "succeeded" },
        ],
      },
    });

    render(<NeedsYourAttention authenticated />);

    expect(await screen.findByText("Needs your attention")).toBeInTheDocument();
    expect(screen.getByText("A RED command is waiting for your approval")).toBeInTheDocument();
    expect(screen.getByText(/never runs without your explicit approval/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review the command/i }))
      .toHaveAttribute("href", "/solutions/bot-manager");
    // Completed routine work is not attention.
    expect(screen.queryByText(/routine audit/i)).not.toBeInTheDocument();
  });

  it("surfaces a broken GitHub connection with its reason and a repair link", async () => {
    stubSources({
      connections: {
        connections: [{
          id: "conn-1",
          name: "example-org",
          status: "error",
          statusReason: "The GitHub App installation is suspended.",
        }],
      },
    });

    render(<NeedsYourAttention authenticated />);

    expect(await screen.findByText('GitHub connection "example-org" needs attention')).toBeInTheDocument();
    expect(screen.getByText("The GitHub App installation is suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open connections/i }))
      .toHaveAttribute("href", "/solutions/connections");
  });

  it("surfaces queued work with no worker, but not when the worker is connected", async () => {
    stubSources({
      commands: { commands: [{ id: "c-1", prompt: "Build it", risk: "green", status: "queued" }] },
      worker: { worker: { connectionStatus: "not_connected" } },
    });

    render(<NeedsYourAttention authenticated />);

    expect(await screen.findByText("Work is queued, but no worker is connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /check worker status/i }))
      .toHaveAttribute("href", "/solutions/bot-manager");
  });

  it("surfaces an unresolved owner-flagged incident and skips resolved ones", async () => {
    stubSources({
      operations: {
        incidents: [
          {
            id: "i-1", title: "Checkout is failing", projectName: "Shop", severity: "sev1",
            status: "open", impact: "Customers cannot pay.", resolvedAt: null, ownerAttentionRequired: true,
          },
          {
            id: "i-2", title: "Old outage", projectName: "Shop", severity: "sev2",
            status: "resolved", impact: null, resolvedAt: "2026-08-15T00:00:00Z", ownerAttentionRequired: true,
          },
          {
            id: "i-3", title: "Auto-recovering blip", projectName: "Shop", severity: "sev3",
            status: "open", impact: null, resolvedAt: null, ownerAttentionRequired: false,
          },
        ],
      },
    });

    render(<NeedsYourAttention authenticated />);

    expect(await screen.findByText(/Production incident in Shop: Checkout is failing/)).toBeInTheDocument();
    expect(screen.getByText("Customers cannot pay.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open operations/i }))
      .toHaveAttribute("href", "/solutions/operations");
    expect(screen.queryByText(/Old outage/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Auto-recovering blip/)).not.toBeInTheDocument();
  });

  it("keeps one failed source from suppressing the others", async () => {
    stubSources({
      commands: {
        commands: [{ id: "c-1", prompt: "Risky change", risk: "red", status: "awaiting_approval" }],
      },
      operationsStatus: 500,
      operations: { error: { message: "operations unavailable" } },
      connectionsStatus: 503,
      connections: { error: { message: "connections unavailable" } },
    });

    render(<NeedsYourAttention authenticated />);

    // The approval item still appears; the broken sources stay silent rather
    // than inventing items or erroring the section.
    expect(await screen.findByText("A RED command is waiting for your approval")).toBeInTheDocument();
    expect(screen.queryByText(/needs attention"/)).not.toBeInTheDocument();
  });

  it("surfaces a failed run with the reason it failed", async () => {
    // The gap this closes: on 2026-08-16 a command failed three times and
    // nothing the owner was looking at said so.
    stubSources({
      runs: {
        runs: [{
          id: "run-1",
          status: "failed",
          errorMessage: "Dependency bootstrap failed.",
          task: { title: "Audit Round 2" },
        }],
      },
    });

    render(<NeedsYourAttention authenticated />);

    expect(await screen.findByText("Work failed: Audit Round 2")).toBeInTheDocument();
    expect(screen.getByText("Dependency bootstrap failed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open runs/i })).toHaveAttribute("href", "/solutions/runs");
  });

  it("counts several failures instead of listing each", async () => {
    stubSources({
      runs: {
        runs: [
          { id: "run-1", status: "failed", task: { title: "One" } },
          { id: "run-2", status: "failed", task: { title: "Two" } },
          { id: "run-3", status: "succeeded", task: { title: "Fine" } },
        ],
      },
    });

    render(<NeedsYourAttention authenticated />);

    expect(await screen.findByText("2 runs failed")).toBeInTheDocument();
    // A successful run is not an item: this area earns attention by never
    // crying wolf.
    expect(screen.queryByText(/Fine/)).not.toBeInTheDocument();
  });
});
