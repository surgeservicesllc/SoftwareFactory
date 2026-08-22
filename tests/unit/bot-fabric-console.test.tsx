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

  it("connects Claude with no command and no check-now: the broker drives the real login", async () => {
    let codePosted = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ai-accounts/connect" && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({
          accountId: "acc-1", sessionId: "sess-1", expiresInSeconds: 900, workerWoken: true,
        }) };
      }
      if (url === "/api/ai-accounts/sessions/sess-1") {
        return { ok: true, status: 200, json: async () => ({ session: {
          id: "sess-1",
          accountId: "acc-1",
          status: codePosted ? "connected" : "awaiting_user",
          loginUrl: "https://claude.com/cai/oauth/authorize?code=true",
          failureReason: null,
          heartbeatAt: "2026-08-16T14:00:00.000Z",
          expiresAt: "2026-08-16T15:00:00.000Z",
          updatedAt: "2026-08-16T14:00:00.000Z",
        } }) };
      }
      if (url === "/api/ai-accounts/sessions/sess-1/code" && init?.method === "POST") {
        codePosted = true;
        return { ok: true, status: 200, json: async () => ({ accepted: true }) };
      }
      if (url === "/api/ai-accounts") {
        return { ok: true, status: 200, json: async () => ({
          accounts: [{ id: "acc-1", credentialPurpose: "claude" }],
        }) };
      }
      if (url === "/api/bots/connect/provision") {
        return { ok: true, status: 200, json: async () => ({ provisioned: true, outcome: "created" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ...fabricPayload, bots: [], assignments: [] }) };
    }));
    const user = userEvent.setup();

    render(<BotFabricConsole />);

    // The branded front door — and from here, nothing to copy: the worker
    // runs Claude's real login and the page updates itself.
    await user.click(await screen.findByRole("button", { name: /^claude$/i }));

    const continueLink = await screen.findByRole("link", { name: /open claude sign-in/i });
    expect(continueLink).toHaveAttribute("href", "https://claude.com/cai/oauth/authorize?code=true");
    expect(screen.queryByText(/scripts\/connect\.mts/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check now/i })).not.toBeInTheDocument();

    // The provider showed a confirmation code; it is pasted HERE, never into
    // a terminal.
    await user.type(
      screen.getByPlaceholderText(/paste the confirmation code/i), "AC-123-XYZ",
    );
    await user.click(screen.getByRole("button", { name: /finish connecting/i }));

    // The next poll reads connected from the database and the bot is
    // provisioned against the account's slot — no further clicks.
    expect(
      await screen.findByText(/ready for assignments/i, {}, { timeout: 9_000 }),
    ).toBeInTheDocument();
    const provisionBody = vi.mocked(fetch).mock.calls
      .filter(([request]) => String(request) === "/api/bots/connect/provision")
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(provisionBody[0]).toMatchObject({
      provider: "anthropic", credential: "subscription", aiAccountId: "acc-1",
    });
    const codeBody = vi.mocked(fetch).mock.calls
      .filter(([request]) => String(request) === "/api/ai-accounts/sessions/sess-1/code")
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(codeBody[0]).toEqual({ code: "AC-123-XYZ" });

    // Many Claude bots, many Claude accounts — both follow-ups, never capped.
    expect(screen.getByRole("button", { name: /add another claude bot/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect another claude account/i })).toBeInTheDocument();
  }, 15_000);

  it("falls back to the manual command when the broker sign-in cannot start", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ai-accounts/connect" && init?.method === "POST") {
        return { ok: false, status: 503, json: async () => ({
          error: { code: "credential_store_not_configured", message: "The credential store is not set up." },
        }) };
      }
      if (url === "/api/bots/connect" && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({
          command: "npx -y tsx scripts/connect.mts claude --code abc --host https://factory.test",
          expiresInSeconds: 600,
        }) };
      }
      if (url === "/api/bots/providers") {
        return { ok: true, status: 200, json: async () => ({
          providers: [{ id: "anthropic", subscriptionReady: false }],
        }) };
      }
      return { ok: true, status: 200, json: async () => ({ ...fabricPayload, bots: [], assignments: [] }) };
    }));
    const user = userEvent.setup();

    render(<BotFabricConsole />);

    await user.click(await screen.findByRole("button", { name: /^claude$/i }));

    // The broker backend is unavailable, so the command flow starts BY
    // ITSELF: one click on Claude still reaches a working sign-in, with no
    // error tile and no second click. "Could not be started" must never be
    // the owner's problem to route around.
    expect(await screen.findByText(/scripts\/connect\.mts claude/)).toBeInTheDocument();
    expect(screen.queryByText(/did not finish/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use the manual command instead/i }))
      .not.toBeInTheDocument();
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

  it("disables assignment when the server reports current readiness is not ready", async () => {
    stubFetch({
      status: 200,
      body: {
        ...fabricPayload,
        bots: [{
          ...fabricPayload.bots[0],
          currentReadiness: "not_connected",
          currentReadinessDetail: "The subscription credential is missing.",
        }],
      },
    });

    render(<BotFabricConsole />);

    const assign = await screen.findByRole("button", { name: /assign claude/i });
    expect(assign).toBeDisabled();
    expect(assign).toHaveAttribute("title", "The subscription credential is missing.");
  });

  it("marks a first posting as expecting no current assignment", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)));
        return { ok: true, status: 201, json: async () => ({ assignment: {} }) } as Response;
      }
      return { ok: true, status: 200, json: async () => fabricPayload } as Response;
    }));
    const user = userEvent.setup();
    render(<BotFabricConsole />);

    await user.click(await screen.findByRole("button", { name: /assign claude/i }));

    expect(bodies[0]).toEqual({
      botId: "bot-1",
      projectId: "project-1",
      roleId: "role-1",
      expectedAssignmentId: null,
      expectedProjectId: null,
      expectedRevision: null,
    });
  });

  it("carries exact posting identity on move, pause, and release", async () => {
    const assignedPayload = {
      ...fabricPayload,
      projects: [
        ...fabricPayload.projects,
        { ...fabricPayload.projects[0], id: "project-2", name: "Second project" },
      ],
      assignments: [{
        id: "assignment-1",
        revision: 7,
        botId: "bot-1",
        projectId: "project-1",
        roleId: "role-1",
        status: "active",
        assignedAt: "2026-08-22T00:00:00.000Z",
        releasedAt: null,
        model: null,
        workEffort: "medium",
        config: {},
      }],
    };
    const mutations: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" || init?.method === "PATCH") {
        mutations.push({ url: String(input), body: JSON.parse(String(init.body)) });
        return { ok: true, status: 200, json: async () => ({ assignment: {} }) } as Response;
      }
      return { ok: true, status: 200, json: async () => assignedPayload } as Response;
    }));
    const user = userEvent.setup();
    render(<BotFabricConsole />);

    await user.selectOptions(await screen.findByLabelText("Move to project"), "project-2");
    await waitFor(() => expect(mutations).toHaveLength(1));
    const pause = screen.getByRole("button", { name: /pause/i });
    await waitFor(() => expect(pause).toBeEnabled());
    await user.click(pause);
    await waitFor(() => expect(mutations).toHaveLength(2));
    const release = screen.getByRole("button", { name: /return to bench/i });
    await waitFor(() => expect(release).toBeEnabled());
    await user.click(release);
    await waitFor(() => expect(mutations).toHaveLength(3));

    expect(mutations).toEqual(expect.arrayContaining([
      {
        url: "/api/bot-assignments",
        body: expect.objectContaining({
          expectedAssignmentId: "assignment-1",
          expectedProjectId: "project-1",
          expectedRevision: 7,
        }),
      },
      {
        url: "/api/bot-assignments/assignment-1",
        body: {
          status: "paused",
          expectedProjectId: "project-1",
          expectedRevision: 7,
        },
      },
      {
        url: "/api/bot-assignments/assignment-1",
        body: {
          status: "released",
          expectedProjectId: "project-1",
          expectedRevision: 7,
        },
      },
    ]));
  });

  it("changes an active posting role in place with its exact identity", async () => {
    const secondRole = {
      ...fabricPayload.roles[0],
      id: "role-2",
      name: "Reviewer",
      slug: "reviewer",
    };
    const assignedPayload = {
      ...fabricPayload,
      roles: [...fabricPayload.roles, secondRole],
      assignments: [{
        id: "assignment-1",
        revision: 7,
        botId: "bot-1",
        projectId: "project-1",
        roleId: "role-1",
        status: "active",
        assignedAt: "2026-08-22T00:00:00.000Z",
        releasedAt: null,
        model: null,
        workEffort: "medium",
        config: {},
      }],
    };
    const mutations: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        mutations.push({ url: String(input), body: JSON.parse(String(init.body)) });
        return { ok: true, status: 201, json: async () => ({ assignment: {} }) } as Response;
      }
      return { ok: true, status: 200, json: async () => assignedPayload } as Response;
    }));
    const user = userEvent.setup();
    render(<BotFabricConsole />);

    await user.selectOptions(await screen.findByLabelText("Role"), secondRole.id);
    await waitFor(() => expect(mutations).toHaveLength(1));

    expect(mutations[0]).toEqual({
      url: "/api/bot-assignments",
      body: {
        botId: "bot-1",
        projectId: "project-1",
        roleId: secondRole.id,
        expectedAssignmentId: "assignment-1",
        expectedProjectId: "project-1",
        expectedRevision: 7,
      },
    });
  });

  it("requires an explicit resume before a paused posting can move or change role", async () => {
    const pausedPayload = {
      ...fabricPayload,
      projects: [
        ...fabricPayload.projects,
        { ...fabricPayload.projects[0], id: "project-2", name: "Second project" },
      ],
      roles: [
        ...fabricPayload.roles,
        { ...fabricPayload.roles[0], id: "role-2", name: "Reviewer", slug: "reviewer" },
      ],
      assignments: [{
        id: "assignment-1",
        revision: 7,
        botId: "bot-1",
        projectId: "project-1",
        roleId: "role-1",
        status: "paused",
        assignedAt: "2026-08-22T00:00:00.000Z",
        releasedAt: null,
        model: null,
        workEffort: "medium",
        config: {},
      }],
    };
    stubFetch({ status: 200, body: pausedPayload });
    render(<BotFabricConsole />);

    const move = await screen.findByLabelText("Move to project");
    const role = screen.getByLabelText("Role");
    expect(move).toBeDisabled();
    expect(role).toBeDisabled();
    expect(move).toHaveAttribute(
      "title",
      "Resume this posting before moving it or changing its role.",
    );
    expect(screen.getByRole("button", { name: /resume/i })).toBeEnabled();
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

  it("requires a provider endpoint and submits every manual bot field at the API boundary", async () => {
    const registrations: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/bots" && init?.method === "POST") {
        registrations.push(JSON.parse(String(init.body)));
        return { ok: true, status: 201, json: async () => ({ bot: {} }) } as Response;
      }
      if (url === "/api/bots/providers") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            providers: [{
              id: "selfhosted",
              label: "Self-hosted",
              vendor: "Your infrastructure",
              monogram: "SH",
              accent: "#60d8ff",
              summary: "A private model gateway.",
              suggestedModels: ["llama3.1:70b"],
              defaultModel: "llama3.1:70b",
              credentialRef: null,
              credentialReady: true,
              credentialOptional: true,
              probeVerdict: "not_configured",
              probeReason: null,
              probeLive: false,
              requiresBaseUrl: true,
              docsUrl: "https://docs.vllm.ai",
              apiKeyUrl: null,
            }],
          }),
        } as Response;
      }
      if (url === "/api/ai-accounts") {
        return { ok: true, status: 200, json: async () => ({ accounts: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => fabricPayload } as Response;
    }));
    const user = userEvent.setup();

    render(<BotFabricConsole />);
    await user.click(await screen.findByRole("tab", { name: /bots/i }));
    await user.click(await screen.findByRole("button", { name: /self-hosted/i }));
    await user.click(screen.getByRole("button", { name: /customise name, model and endpoint/i }));

    const connect = screen.getByRole("button", { name: /connect self-hosted/i });
    const endpoint = screen.getByLabelText("HTTPS endpoint (required)");
    expect(endpoint).toBeRequired();
    expect(connect).toBeDisabled();

    await user.clear(screen.getByLabelText("Bot name"));
    await user.type(screen.getByLabelText("Bot name"), "  Edge Runner  ");
    await user.clear(screen.getByLabelText("Model identifier"));
    await user.type(screen.getByLabelText("Model identifier"), "  qwen2.5-coder:32b  ");
    await user.type(screen.getByLabelText("Credential variable name"), "  PRIVATE_GATEWAY_TOKEN  ");
    await user.type(endpoint, "  https://models.example.test/v1  ");
    await user.type(screen.getByLabelText("Notes"), "  Runs private code review  ");
    expect(connect).toBeEnabled();
    await user.click(connect);

    await waitFor(() => expect(registrations).toHaveLength(1));
    expect(registrations[0]).toEqual({
      provider: "selfhosted",
      name: "Edge Runner",
      model: "qwen2.5-coder:32b",
      credentialRef: "PRIVATE_GATEWAY_TOKEN",
      baseUrl: "https://models.example.test/v1",
      notes: "Runs private code review",
    });
  });

  it("submits every authored role field with normalized capabilities", async () => {
    const roleWrites: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/bot-roles" && init?.method === "POST") {
        roleWrites.push(JSON.parse(String(init.body)));
        return { ok: true, status: 201, json: async () => ({ role: {} }) } as Response;
      }
      if (url === "/api/ai-accounts") {
        return { ok: true, status: 200, json: async () => ({ accounts: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => fabricPayload } as Response;
    }));
    const user = userEvent.setup();

    render(<BotFabricConsole />);
    await user.click(await screen.findByRole("tab", { name: /roles/i }));
    await user.click(screen.getByRole("button", { name: /new role/i }));
    await user.type(screen.getByLabelText("Role name"), "  Release Captain  ");
    expect(screen.getByLabelText("Slug")).toHaveValue("release-captain");
    await user.type(screen.getByLabelText("Summary"), "  Owns release readiness  ");
    await user.type(
      screen.getByLabelText("Instructions"),
      "  Verify tests, preserve containment, and report evidence.  ",
    );
    await user.selectOptions(screen.getByLabelText("Risk ceiling"), "RED");
    await user.type(
      screen.getByLabelText("Capabilities"),
      " release, deployment , evidence ",
    );
    await user.click(screen.getByRole("button", { name: /save role/i }));

    await waitFor(() => expect(roleWrites).toHaveLength(1));
    expect(roleWrites[0]).toEqual({
      roleId: null,
      name: "Release Captain",
      slug: "release-captain",
      summary: "Owns release readiness",
      instructions: "Verify tests, preserve containment, and report evidence.",
      riskCeiling: "RED",
      capabilities: ["release", "deployment", "evidence"],
    });
  });

  it("hides management controls from a read-only member", async () => {
    stubFetch({ status: 200, body: { ...fabricPayload, canManage: false } });

    render(<BotFabricConsole />);

    expect(await screen.findByRole("button", { name: /assign claude/i })).toBeDisabled();
    expect(screen.getByText(/read access to this fabric/i)).toBeInTheDocument();
  });
});
