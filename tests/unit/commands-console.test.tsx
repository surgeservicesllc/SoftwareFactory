import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandsConsole, commandProgress } from "@/components/commands-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmd-1",
    prompt: "Audit the site",
    risk: "yellow",
    status: "queued",
    submittedAt: "2026-08-16T20:00:00.000Z",
    project: { id: "p-1", name: "SoftwareFactory" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("commandProgress", () => {
  it("says what each status means for the person who saved the request", () => {
    // The raw status word was accurate and unhelpful: "queued" never answered
    // "how can I see it is working?" (owner, 2026-08-16).
    expect(commandProgress("queued")).toEqual({
      hint: "Waiting for a worker to pick it up.",
      trackable: true,
    });
    expect(commandProgress("running").hint).toMatch(/working on this now/i);
    expect(commandProgress("failed").hint).toMatch(/can be retried/i);

    // Nothing to watch yet: no run exists before approval or checking.
    expect(commandProgress("awaiting_approval").trackable).toBe(false);
    expect(commandProgress("submitted").trackable).toBe(false);

    // An unknown status invents nothing.
    expect(commandProgress("something_new")).toEqual({ hint: "", trackable: false });
  });
});

describe("CommandsConsole", () => {
  it("tells a queued request where to watch it happen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ commands: [command()] })));

    render(<CommandsConsole />);

    expect(await screen.findByText("Audit the site")).toBeInTheDocument();
    expect(screen.getByText(/waiting for a worker to pick it up/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /watch it on runs/i }))
      .toHaveAttribute("href", "/solutions/runs");
  });

  it("offers no run link for work that has not reached one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ commands: [command({ status: "awaiting_approval", risk: "red" })] }),
    ));

    render(<CommandsConsole />);

    expect(await screen.findByText(/waiting for your approval/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /watch it on runs/i })).not.toBeInTheDocument();
  });
});
