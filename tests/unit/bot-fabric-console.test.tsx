import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BotFabricConsole } from "@/components/bot-fabric-console";

const fabricPayload = {
  activeOrganizationId: "11111111-2222-4333-8444-555555555555",
  canManage: true,
  bots: [
    {
      id: "bot-1",
      name: "Claude",
      provider: "anthropic",
      providerLabel: "Claude",
      providerVendor: "Anthropic",
      model: "claude-opus-5",
      credentialRef: "ANTHROPIC_API_KEY",
      credentialPresent: true,
      baseUrl: null,
      notes: null,
      readiness: "ready",
      readinessLabel: "Ready to assign",
      readinessTone: "safe",
      readinessDetail: "Credential reference resolves server-side. No worker is connected yet.",
      lastCheckedAt: "2026-08-12T10:00:00.000Z",
      currentReadiness: "ready",
      currentReadinessDetail: "Credential reference resolves server-side.",
      createdAt: "2026-08-12T09:00:00.000Z",
    },
  ],
  roles: [
    {
      id: "role-1",
      name: "Frontend engineer",
      slug: "frontend",
      summary: "Builds interface work.",
      instructions: "Implement interface changes.",
      riskCeiling: "GREEN",
      capabilities: ["ui"],
      createdAt: "2026-08-12T09:00:00.000Z",
      updatedAt: "2026-08-12T09:00:00.000Z",
    },
  ],
  assignments: [],
  projects: [
    {
      id: "project-1",
      name: "SoftwareFactory",
      status: "active",
      githubRepository: "surgeservicesllc/SoftwareFactory",
      healthStatus: "unknown",
    },
  ],
  executor: {
    connected: false,
    label: "Not Connected",
    detail:
      "Bots, roles, and assignments are control-plane records. No worker executes them in this phase.",
    globalKillSwitchActive: true,
  },
};

function stubFetch(response: { status: number; body?: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body ?? {},
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BotFabricConsole", () => {
  it("asks an unauthenticated visitor to sign in rather than showing an empty fleet", async () => {
    stubFetch({ status: 401 });

    render(<BotFabricConsole />);

    expect(await screen.findByText(/sign in to manage your bots/i)).toBeInTheDocument();
    // Both halves of the old value were stale: /sign-in is a legacy redirect,
    // and /bot-manager moved under /solutions with the rest of the console, so
    // signing in returned the visitor to a path that no longer exists.
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/auth/sign-in?next=%2Fsolutions%2Fbot-manager",
    );
  });

  it("finishes a one-click sign-in by provisioning a bot and saying so", async () => {
    // Land as the OAuth callback does: back on the console with ?connect=connected.
    window.history.replaceState(null, "", "/solutions/bot-manager?connect=connected");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/bots/connect/provision") {
        return { ok: true, status: 200, json: async () => ({ provisioned: true, outcome: "created" }) };
      }
      return { ok: true, status: 200, json: async () => fabricPayload };
    }));

    render(<BotFabricConsole />);

    // The console provisions as the authenticated owner — the callback could
    // not — and reports that a bot is waiting.
    expect(await screen.findByText(/a ready bot is waiting in your fleet/i)).toBeInTheDocument();
    expect(calls).toContain("POST /api/bots/connect/provision");
    // The outcome is cleared from the URL so a refresh does not repeat it.
    expect(window.location.search).toBe("");

    window.history.replaceState(null, "", "/");
  });

  it("pairs a failed sign-in return with the button that starts it again", async () => {
    // Land as the OAuth callback does on failure: ?connect=failed.
    window.history.replaceState(null, "", "/solutions/bot-manager?connect=failed");
    stubFetch({ status: 200, body: fabricPayload });

    render(<BotFabricConsole />);

    // The notice says nothing was connected — and carries the retry, because
    // "start it again" without a button is a dead end.
    expect(await screen.findByText(/could not be completed/i)).toBeInTheDocument();
    const retry = screen.getByRole("link", { name: /try signing in again/i });
    expect(retry).toHaveAttribute("href", "/api/bots/connect/oauth/start");

    window.history.replaceState(null, "", "/");
  });

  it("connects Claude end to end from the button: command, sign-in, ready bot", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/bots/connect" && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({
          command: "npx -y tsx scripts/connect.mts claude --code abc --host https://factory.test",
          expiresInSeconds: 600,
        }) };
      }
      if (url === "/api/bots/providers") {
        // First consulted before the command (not yet signed in), then after
        // the person clicks check-now (signed in).
        const signedIn = calls.filter((entry) => entry === "GET /api/bots/providers").length > 1;
        return { ok: true, status: 200, json: async () => ({
          providers: [{ id: "anthropic", subscriptionReady: signedIn }],
        }) };
      }
      if (url === "/api/bots/connect/provision") {
        return { ok: true, status: 200, json: async () => ({ provisioned: true, outcome: "created" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ...fabricPayload, bots: [], assignments: [] }) };
    }));
    const user = userEvent.setup();

    render(<BotFabricConsole />);

    // The branded front door.
    await user.click(await screen.findByRole("button", { name: /^claude$/i }));
    // Claude's own login runs from one pre-filled command; the console shows
    // it and watches for completion.
    expect(await screen.findByText(/scripts\/connect\.mts claude/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /i have signed in/i }));

    // Once the sign-in lands, the bot is provisioned against the subscription
    // credential and announced Ready — no further steps.
    expect(await screen.findByText(/ready for assignments/i)).toBeInTheDocument();
    const provisionBody = vi.mocked(fetch).mock.calls
      .filter(([input]) => String(input) === "/api/bots/connect/provision")
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(provisionBody[0]).toMatchObject({ provider: "anthropic", credential: "subscription" });

    // Many Claude bots: the follow-up action repeats the finish.
    expect(screen.getByRole("button", { name: /add another claude bot/i })).toBeInTheDocument();
  });

  it("connects Codex the same way: its own sign-in, then a Ready bot", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/bots/connect" && init?.method === "POST") {
        const purpose = (JSON.parse(String(init.body)) as { purpose: string }).purpose;
        return { ok: true, status: 200, json: async () => ({
          command: `npx -y tsx scripts/connect.mts ${purpose} --code abc --host https://factory.test`,
          expiresInSeconds: 600,
        }) };
      }
      if (url === "/api/bots/providers") {
        const signedIn = calls.filter((entry) => entry === "GET /api/bots/providers").length > 1;
        return { ok: true, status: 200, json: async () => ({
          providers: [{ id: "openai", subscriptionReady: signedIn }],
        }) };
      }
      if (url === "/api/bots/connect/provision") {
        return { ok: true, status: 200, json: async () => ({ provisioned: true, outcome: "created" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ...fabricPayload, bots: [], assignments: [] }) };
    }));
    const user = userEvent.setup();

    render(<BotFabricConsole />);

    await user.click(await screen.findByRole("button", { name: /codex \/ gpt/i }));
    expect(await screen.findByText(/scripts\/connect\.mts codex/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /i have signed in/i }));

    expect(await screen.findByText(/your codex \/ gpt bot is ready for assignments/i)).toBeInTheDocument();
    const provisionBody = vi.mocked(fetch).mock.calls
      .filter(([input]) => String(input) === "/api/bots/connect/provision")
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(provisionBody[0]).toMatchObject({ provider: "openai", credential: "subscription" });
    expect(screen.getByRole("button", { name: /add another codex \/ gpt bot/i })).toBeInTheDocument();
  });

  it("leads an empty fleet with a one-click sign-in, not a form", async () => {
    stubFetch({ status: 200, body: { ...fabricPayload, bots: [], assignments: [] } });

    render(<BotFabricConsole />);

    // The front door is the genuinely one-click path (OpenRouter OAuth, which
    // fronts Claude/GPT/Gemini and auto-provisions a ready bot on return), a
    // real anchor to the route handler that 302s off-origin.
    const signIn = await screen.findByRole("link", { name: /sign in and add my first bot/i });
    expect(signIn).toHaveAttribute("href", "/api/bots/connect/oauth/start");
    expect(screen.getByText(/connect a bot in one click/i)).toBeInTheDocument();
    // The manual path stays available, one step down.
    expect(screen.getByRole("button", { name: /add one manually/i })).toBeInTheDocument();
  });

  it("states that no worker is connected alongside the fleet", async () => {
    stubFetch({ status: 200, body: fabricPayload });

    render(<BotFabricConsole />);

    expect(await screen.findByText(/worker not connected/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no worker executes them in this phase/i),
    ).toBeInTheDocument();
  });

  it("offers a one-step posting for every unassigned bot", async () => {
    stubFetch({ status: 200, body: fabricPayload });

    render(<BotFabricConsole />);

    expect(await screen.findByRole("button", { name: /assign claude/i })).toBeEnabled();
    expect(screen.getByLabelText(/project/i)).toHaveValue("project-1");
    expect(screen.getByLabelText(/role/i)).toHaveValue("role-1");
  });

  it("shows the credential reference name and never a credential value", async () => {
    stubFetch({ status: 200, body: fabricPayload });

    render(<BotFabricConsole />);

    expect(await screen.findByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
  });

  it("lets a manager reach the provider picker from the bots tab", async () => {
    stubFetch({ status: 200, body: fabricPayload });
    const user = userEvent.setup();

    render(<BotFabricConsole />);
    await user.click(await screen.findByRole("tab", { name: /bots/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /grok/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /gemini/i })).toBeInTheDocument();
    // The wording changed when the picker was redesigned, but the guarantee it
    // states has not: this page never receives a key.
    expect(
      screen.getByText(/never pass through this page/i),
    ).toBeInTheDocument();
  });

  it("hides management controls from a read-only member", async () => {
    stubFetch({ status: 200, body: { ...fabricPayload, canManage: false } });

    render(<BotFabricConsole />);

    expect(await screen.findByRole("button", { name: /assign claude/i })).toBeDisabled();
    expect(screen.getByText(/read access to this fabric/i)).toBeInTheDocument();
  });
});
