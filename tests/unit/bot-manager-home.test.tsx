import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BotManagerHome } from "@/components/bot-manager/home";

const connectedAccount = {
  id: "acc-1",
  provider: "anthropic",
  providerLabel: "Claude",
  displayName: "Claude account 1",
  status: "connected",
  lastVerifiedAt: null,
  lastError: null,
};

const readyBot = {
  id: "bot-1",
  name: "Claude Builder 1",
  provider: "anthropic",
  providerLabel: "Claude",
  readiness: "ready",
  readinessLabel: "Ready to assign",
};

function stub(options: {
  accounts?: unknown[];
  bots?: unknown[];
  roles?: unknown[];
  projects?: unknown[];
  extra?: (url: string, init?: RequestInit) => Response | null;
}) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const handled = options.extra?.(url, init);
    if (handled) return handled;
    if (url === "/api/ai-accounts") {
      return {
        ok: true, status: 200,
        json: async () => ({ accounts: options.accounts ?? [], canManage: true }),
      } as unknown as Response;
    }
    if (url === "/api/bots") {
      return {
        ok: true, status: 200,
        json: async () => ({
          bots: options.bots ?? [],
          assignments: [],
          roles: options.roles ?? [],
          projects: options.projects ?? [],
          canManage: true,
        }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BotManagerHome", () => {
  it("gates a signed-out visitor instead of showing a disabled empty state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => (
      { ok: false, status: 401, json: async () => ({}) } as unknown as Response
    )));

    render(<BotManagerHome />);

    expect(await screen.findByRole("heading", { name: /sign in to manage your bots/i }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute(
      "href", "/auth/sign-in?next=%2Fsolutions%2Fbot-manager",
    );
    expect(screen.queryByText(/build your ai team/i)).not.toBeInTheDocument();
  });

  it("greets an empty organization with Build your AI team — and zero terminal anywhere", async () => {
    stub({});

    render(<BotManagerHome />);

    expect(await screen.findByText(/build your ai team/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect claude/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect codex/i })).toBeInTheDocument();
    // The v2 bans, asserted by absence.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/npx|tsx|command|check now|one click|openrouter/i);
    expect(text).not.toMatch(/worker not connected|control.plane/i);
    // Advanced options exist but stay collapsed and secondary.
    expect(screen.getByRole("button", { name: /advanced options/i })).toHaveAttribute(
      "aria-expanded", "false",
    );
  });

  it("walks Add AI Account → Claude → the promise screen, in plain language", async () => {
    stub({});
    const user = userEvent.setup();

    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: /connect claude/i }));

    // §5: the confirm screen names the trust boundary and nothing technical.
    expect(await screen.findByText(/sign in using your existing claude account/i)).toBeInTheDocument();
    expect(screen.getByText(/never receives your claude password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue to claude/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/npx|terminal|token|cli/i);
  });

  it("shows the five-step progress checklist once the connection starts", async () => {
    stub({
      extra: (url, init) => {
        if (url === "/api/ai-accounts/connect" && init?.method === "POST") {
          return {
            ok: true, status: 200,
            json: async () => ({ accountId: "acc-1", sessionId: "sess-1", workerWoken: true }),
          } as unknown as Response;
        }
        if (url === "/api/ai-accounts/sessions/sess-1") {
          return {
            ok: true, status: 200,
            json: async () => ({ session: {
              id: "sess-1", accountId: "acc-1", status: "pending", loginUrl: null,
              failureReason: null, heartbeatAt: null,
              expiresAt: "2026-08-16T23:00:00.000Z", updatedAt: "2026-08-16T22:00:00.000Z",
            } }),
          } as unknown as Response;
        }
        return null;
      },
    });
    const user = userEvent.setup();

    render(<BotManagerHome />);
    await user.click(await screen.findByRole("button", { name: /connect claude/i }));
    await user.click(screen.getByRole("button", { name: /continue to claude/i }));

    expect(await screen.findByText(/connecting claude/i)).toBeInTheDocument();
    expect(screen.getByText(/preparing connection/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for sign-in/i)).toBeInTheDocument();
    expect(screen.getByText(/verifying account/i)).toBeInTheDocument();
    // §10/§34: never a manual confirmation.
    expect(screen.queryByText(/check now/i)).not.toBeInTheDocument();
  });

  it("offers the rename on the connected screen itself, before any next action", async () => {
    const renameBodies: Array<Record<string, unknown>> = [];
    // The account exists only after the connect completes, like production.
    const accountsNow: unknown[] = [];
    const json = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
    stub({
      extra: (url, init) => {
        if (url === "/api/ai-accounts" && init?.method === undefined) {
          return json({ accounts: accountsNow, canManage: true });
        }
        if (url === "/api/ai-accounts/connect" && init?.method === "POST") {
          accountsNow.push({ ...connectedAccount });
          return json({ accountId: "acc-1", sessionId: "sess-1", workerWoken: true });
        }
        if (url === "/api/ai-accounts/sessions/sess-1") {
          return json({ session: {
            id: "sess-1", accountId: "acc-1", status: "connected", loginUrl: null,
            failureReason: null, heartbeatAt: null,
            expiresAt: "2026-08-16T23:00:00.000Z", updatedAt: "2026-08-16T22:00:00.000Z",
          } });
        }
        if (url === "/api/ai-accounts/acc-1/rename" && init?.method === "POST") {
          renameBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          (accountsNow[0] as { displayName: string }).displayName = "My Production Claude";
          return json({ renamed: true });
        }
        return null;
      },
    });
    const user = userEvent.setup();

    render(<BotManagerHome />);
    await user.click(await screen.findByRole("button", { name: /connect claude/i }));
    await user.click(screen.getByRole("button", { name: /continue to claude/i }));

    // The session reports connected, so the success screen appears — with the
    // account name editable right there.
    expect(await screen.findByText(/claude connected/i, undefined, { timeout: 8000 }))
      .toBeInTheDocument();
    // The accounts panel behind the modal offers its own pencil; the one
    // under test is the modal's.
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: /rename claude account 1/i }));
    const input = dialog.getByLabelText(/new name for claude account 1/i);
    await user.clear(input);
    await user.type(input, "My Production Claude");
    await user.click(screen.getByRole("button", { name: /save name/i }));

    expect(renameBodies).toEqual([{ name: "My Production Claude" }]);
    // The saved name shows up everywhere at once — the modal's Account row
    // and the accounts panel behind it both re-read the same list.
    expect((await screen.findAllByText("My Production Claude")).length).toBeGreaterThan(0);
  });

  it("shows summary cards and the AI team once anything exists", async () => {
    stub({ accounts: [connectedAccount], bots: [readyBot] });

    render(<BotManagerHome />);

    // The count and the word are separate lines now — one phrase at tile size
    // wrapped to three on a phone and doubled the card's height.
    const accountsCard = (await screen.findByText("AI Accounts")).parentElement!;
    expect(within(accountsCard).getByText("1")).toBeInTheDocument();
    expect(within(accountsCard).getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/your ai team/i)).toBeInTheDocument();
    expect(screen.getByText("Claude Builder 1")).toBeInTheDocument();
    // No zero-state tab chrome on the primary surface.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("removes a bot only after saying what is released and what is kept", async () => {
    const user = userEvent.setup();
    const deleted: string[] = [];
    stub({
      accounts: [connectedAccount],
      bots: [readyBot],
      extra: (url, init) => {
        if (url === "/api/bots/bot-1" && init?.method === "DELETE") {
          deleted.push(url);
          return { ok: true, status: 200, json: async () => ({ retired: true }) } as unknown as Response;
        }
        return null;
      },
    });

    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: /remove claude builder 1/i }));
    // Nothing is deleted by the first click — the row states the consequence.
    expect(deleted).toEqual([]);
    expect(screen.getByText(/assignments are released; every run and/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove bot/i }));
    expect(deleted).toEqual(["/api/bots/bot-1"]);
  });

  it("keeps the bot when the person backs out of the removal", async () => {
    const user = userEvent.setup();
    const deleted: string[] = [];
    stub({
      accounts: [connectedAccount],
      bots: [readyBot],
      extra: (url, init) => {
        if (init?.method === "DELETE") {
          deleted.push(url);
          return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
        }
        return null;
      },
    });

    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: /remove claude builder 1/i }));
    await user.click(screen.getByRole("button", { name: /keep it/i }));

    expect(deleted).toEqual([]);
    expect(screen.queryByText(/assignments are released/i)).not.toBeInTheDocument();
    expect(screen.getByText("Claude Builder 1")).toBeInTheDocument();
  });
});

const needsReauthAccount = {
  id: "acc-2",
  provider: "anthropic",
  providerLabel: "Claude",
  displayName: "Claude Blackstone",
  status: "needs_reauth",
  lastVerifiedAt: null,
  lastError: "The provider refused the stored credential (HTTP 403).",
};

const role = { id: "00000000-0000-4000-8000-0000000000r1".replace("r1", "01"), name: "Developer" };
const project = { id: "00000000-0000-4000-8000-0000000000p1".replace("p1", "02"), name: "Storefront" };

describe("BotManagerHome — creating a bot", () => {
  it("asks which account should back the bot instead of taking the first", async () => {
    const user = userEvent.setup();
    stub({ accounts: [connectedAccount, needsReauthAccount], bots: [readyBot] });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: /create bot/i }));

    const dialog = await screen.findByRole("dialog", { name: /create bot/i });
    // The connected one is offered; the one that cannot back a bot is not.
    expect(within(dialog).getByRole("button", { name: /claude account 1/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /claude blackstone/i })).toBeNull();
    expect(within(dialog).getByText(/need signing in again are not listed/i)).toBeInTheDocument();
  });

  it("says why it cannot create one when every account needs signing in again", async () => {
    /*
     * The defect this pins: with accounts present but none connected, Create
     * Bot silently opened the *add an account* chooser. Four accounts on
     * screen, and the button offered to add a fifth without a word.
     */
    const user = userEvent.setup();
    stub({ accounts: [needsReauthAccount], bots: [] });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: /create bot/i }));

    const dialog = await screen.findByRole("dialog", { name: /create bot/i });
    expect(within(dialog).getByText(/none of your 1 accounts/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/use reconnect on an account below/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^add ai account$/i })).toBeNull();
  });

  it("offers the account chooser when there is no account at all", async () => {
    const user = userEvent.setup();
    stub({ accounts: [], bots: [readyBot] });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: /create bot/i }));

    const dialog = await screen.findByRole("dialog", { name: /create bot/i });
    expect(within(dialog).getByText(/no ai account is connected yet/i)).toBeInTheDocument();
  });
});

describe("BotManagerHome — putting a bot on a project", () => {
  it("assigns the chosen bot through the project's own endpoint", async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; body: unknown }> = [];
    stub({
      accounts: [connectedAccount],
      bots: [readyBot],
      roles: [role],
      projects: [project],
      extra: (url, init) => {
        if (init?.method === "POST" && url.includes("/bots")) {
          calls.push({ url, body: JSON.parse(String(init.body)) });
          return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
        }
        return null;
      },
    });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: /add to project/i }));
    const dialog = await screen.findByRole("dialog", { name: /add claude builder 1 to a project/i });
    await user.click(within(dialog).getByRole("button", { name: /add to project/i }));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(project.id);
    expect(calls[0].body).toEqual({ bots: [{ botId: readyBot.id, roleId: role.id }] });
  });

  it("repeats the server's refusal rather than a generic failure", async () => {
    const user = userEvent.setup();
    stub({
      accounts: [connectedAccount],
      bots: [readyBot],
      roles: [role],
      projects: [project],
      extra: (url, init) => {
        if (init?.method === "POST" && url.includes("/bots")) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: { message: "Claude Builder 1 is already on Storefront." } }),
          } as unknown as Response;
        }
        return null;
      },
    });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: /add to project/i }));
    const dialog = await screen.findByRole("dialog", { name: /add claude builder 1 to a project/i });
    await user.click(within(dialog).getByRole("button", { name: /add to project/i }));

    expect(await screen.findByText(/already on storefront/i)).toBeInTheDocument();
  });

  it("names the missing prerequisite rather than showing an empty dropdown", async () => {
    const user = userEvent.setup();
    stub({ accounts: [connectedAccount], bots: [readyBot], roles: [role], projects: [] });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: /add to project/i }));
    const dialog = await screen.findByRole("dialog", { name: /add claude builder 1 to a project/i });
    expect(within(dialog).getByText(/has no projects yet/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /create a project/i })).toBeInTheDocument();
  });
});

const secondBot = {
  id: "bot-2",
  name: "Codex Reviewer",
  provider: "openai",
  providerLabel: "Codex",
  readiness: "ready",
  readinessLabel: "Ready to assign",
};

const secondAccount = {
  id: "acc-3",
  provider: "openai",
  providerLabel: "Codex",
  displayName: "Codex Daniel",
  status: "connected",
  lastVerifiedAt: null,
  lastError: null,
};

describe("BotManagerHome — selecting one or many", () => {
  it("assigns every selected bot in a single atomic request", async () => {
    /*
     * One request, not one per bot: `assign_bots_to_project` is atomic, so
     * sending them together is the difference between "these two are on the
     * project" and "one is, work out which".
     */
    const user = userEvent.setup();
    const posts: unknown[] = [];
    stub({
      accounts: [connectedAccount],
      bots: [readyBot, secondBot],
      roles: [role],
      projects: [project],
      extra: (url, init) => {
        if (init?.method === "POST" && url.includes("/bots")) {
          posts.push(JSON.parse(String(init.body)));
          return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
        }
        return null;
      },
    });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: `Select ${readyBot.name}` }));
    await user.click(screen.getByRole("button", { name: `Select ${secondBot.name}` }));
    await user.click(screen.getByRole("button", { name: /add 2 to a project/i }));

    const dialog = await screen.findByRole("dialog", { name: /add 2 bots to a project/i });
    await user.click(within(dialog).getByRole("button", { name: /add to project/i }));

    expect(posts).toEqual([
      { bots: [{ botId: readyBot.id, roleId: role.id }, { botId: secondBot.id, roleId: role.id }] },
    ]);
  });

  it("reports the selection as pressed so its state is not colour alone", async () => {
    const user = userEvent.setup();
    stub({ accounts: [connectedAccount], bots: [readyBot], roles: [role], projects: [project] });
    render(<BotManagerHome />);

    const select = await screen.findByRole("button", { name: `Select ${readyBot.name}` });
    expect(select).toHaveAttribute("aria-pressed", "false");
    await user.click(select);
    expect(select).toHaveAttribute("aria-pressed", "true");
    await user.click(select);
    expect(select).toHaveAttribute("aria-pressed", "false");
  });

  it("creates one bot per selected account, and says which could not", async () => {
    const user = userEvent.setup();
    const provisioned: unknown[] = [];
    stub({
      accounts: [connectedAccount, secondAccount, needsReauthAccount],
      bots: [],
      roles: [role],
      projects: [project],
      extra: (url, init) => {
        if (url === "/api/bots/connect/provision" && init?.method === "POST") {
          provisioned.push(JSON.parse(String(init.body)));
          return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
        }
        return null;
      },
    });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: `Select ${connectedAccount.displayName}` }));
    await user.click(screen.getByRole("button", { name: `Select ${secondAccount.displayName}` }));
    await user.click(screen.getByRole("button", { name: `Select ${needsReauthAccount.displayName}` }));

    // Both numbers, so the button's count is never a mystery.
    expect(screen.getByText(/3 selected · 2 can create a bot/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create 2 bots/i }));

    expect(provisioned).toEqual([
      { provider: "anthropic", credential: "subscription", additional: false },
      { provider: "openai", credential: "subscription", additional: false },
    ]);
  });
});
