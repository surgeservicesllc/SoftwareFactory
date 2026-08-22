import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BotManagerHome } from "@/components/bot-manager/home";

const connectedAccount = {
  id: "acc-1",
  provider: "anthropic",
  providerLabel: "Claude",
  credentialPurpose: "claude",
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

const disconnectedAccount = {
  id: "acc-4",
  provider: "openai",
  providerLabel: "Codex",
  credentialPurpose: "codex",
  displayName: "Codex Daniel",
  status: "disconnected",
  lastVerifiedAt: null,
  lastError: null,
};

const needsReauthAccount = {
  id: "acc-2",
  provider: "anthropic",
  providerLabel: "Claude",
  credentialPurpose: "claude_2",
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
    /*
     * Both accounts that still hold credential material are offered — including
     * the one whose last verification came back 403, because
     * `mark_ai_account_needs_reauth` writes only `status` and `last_error` and
     * a bot's readiness is resolved from credential presence. Only the
     * disconnected one, whose credential was removed, is absent.
     */
    expect(within(dialog).getByRole("button", { name: /claude account 1/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /claude blackstone/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /codex daniel/i })).toBeNull();
  });

  it("translates the broker purpose before creating the chosen account's bot", async () => {
    const user = userEvent.setup();
    const provisioned: unknown[] = [];
    stub({
      accounts: [connectedAccount],
      bots: [],
      extra: (url, init) => {
        if (url !== "/api/bots/connect/provision" || init?.method !== "POST") return null;
        provisioned.push(JSON.parse(String(init.body)));
        return {
          ok: true,
          status: 200,
          json: async () => ({ provisioned: true, outcome: "created" }),
        } as unknown as Response;
      },
    });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: /create bot/i }));
    await user.click(
      within(screen.getByRole("dialog", { name: /create bot/i }))
        .getByRole("button", { name: /claude account 1/i }),
    );

    expect(provisioned).toEqual([{
      provider: "anthropic",
      credential: "subscription",
      additional: false,
    }]);
  });

  it("says why it cannot create one when no account holds a credential", async () => {
    /*
     * The defect this pins: with accounts present but none usable, Create Bot
     * silently opened the *add an account* chooser. Four accounts on screen,
     * and the button offered to add a fifth without a word.
     */
    const user = userEvent.setup();
    stub({ accounts: [disconnectedAccount], bots: [] });
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
      accounts: [connectedAccount, needsReauthAccount, disconnectedAccount],
      bots: [],
      roles: [role],
      projects: [project],
      extra: (url, init) => {
        if (url === "/api/bots/connect/provision" && init?.method === "POST") {
          provisioned.push(JSON.parse(String(init.body)));
          return {
            ok: true, status: 200,
            json: async () => ({ provisioned: true, outcome: "created" }),
          } as unknown as Response;
        }
        return null;
      },
    });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: `Select ${connectedAccount.displayName}` }));
    await user.click(screen.getByRole("button", { name: `Select ${needsReauthAccount.displayName}` }));
    await user.click(screen.getByRole("button", { name: `Select ${disconnectedAccount.displayName}` }));

    // One count for what cannot be done at all, a separate line for what can
    // be done but will wait — they are different facts and were being conflated.
    expect(screen.getByText(/3 selected · 1 cannot back a bot yet/i)).toBeInTheDocument();
    expect(screen.getByText(/needs signing in again/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create 2 bots/i }));

    // Both are Claude, so the second asks for an additional bot rather than
    // being told one already exists.
    expect(provisioned).toEqual([
      { provider: "anthropic", credential: "subscription", additional: false },
      { provider: "anthropic", credential: "subscription_2", additional: true },
    ]);
  });

  it("does not celebrate a 200 that made nothing: a skipped provision shows its sentence", async () => {
    /*
     * The provision endpoint answers 200 for "the database refused" too, by
     * design — the connect flow must never turn a stored credential into a
     * failure. The console celebrating that 200 is exactly how the owner
     * followed every step and ended with zero bots.
     */
    const user = userEvent.setup();
    stub({
      accounts: [connectedAccount],
      bots: [],
      roles: [role],
      projects: [project],
      extra: (url, init) => {
        if (url === "/api/bots/connect/provision" && init?.method === "POST") {
          return {
            ok: true, status: 200,
            json: async () => ({
              provisioned: false,
              outcome: "skipped",
              reason: "The bot could not be created: owner or admin role is required.",
            }),
          } as unknown as Response;
        }
        return null;
      },
    });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: `Select ${connectedAccount.displayName}` }));
    await user.click(screen.getByRole("button", { name: /create 1 bot/i }));

    expect(
      await screen.findByText(/0 created, 1 failed\. The bot could not be created: owner or admin role is required\./),
    ).toBeInTheDocument();
  });
});

describe("BotManagerHome — inside the AI Factory", () => {
  const project2 = { id: "00000000-0000-4000-8000-000000000099", name: "Factory Two" };

  it("adds the selected bots to the journey's project and returns", async () => {
    const user = userEvent.setup();
    const assigned: unknown[] = [];
    let finished = 0;
    stub({
      accounts: [connectedAccount],
      bots: [readyBot, secondBot],
      roles: [role],
      projects: [project],
      extra: (url, init) => {
        if (init?.method === "POST" && url.includes(`/projects/${project2.id}/bots`)) {
          assigned.push(JSON.parse(String(init.body)));
          return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
        }
        return null;
      },
    });
    render(
      <BotManagerHome projectContext={project2} onFinished={() => { finished += 1; }} />,
    );

    await user.click(await screen.findByRole("button", { name: `Select ${readyBot.name}` }));
    await user.click(screen.getByRole("button", { name: `Select ${secondBot.name}` }));
    // The project is named in place; no second screen asks for it again.
    expect(screen.getByText(/add 2 selected items to/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^add bots$/i }));

    expect(assigned).toEqual([
      { bots: [{ botId: readyBot.id, roleId: role.id }, { botId: secondBot.id, roleId: role.id }] },
    ]);
    expect(finished).toBe(1);
  });

  it("creates a bot for a selected account first, then assigns what appeared", async () => {
    /*
     * The provision endpoint answers "made one" or "already had one" rather
     * than naming a row, so the new bot is identified by the id that appears
     * between the two reads of /api/bots. Inventing one from the account would
     * be a guess that assigns the wrong bot.
     */
    const user = userEvent.setup();
    const assigned: unknown[] = [];
    const provisioned: unknown[] = [];
    let botsRead = 0;
    const newBot = { ...readyBot, id: "bot-new", name: "Claude Builder 2" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ai-accounts") {
        return {
          ok: true, status: 200,
          json: async () => ({ accounts: [needsReauthAccount], canManage: true }),
        } as unknown as Response;
      }
      if (url === "/api/bots/connect/provision") {
        provisioned.push(JSON.parse(String(init?.body)));
        return {
          ok: true, status: 200,
          json: async () => ({ provisioned: true, outcome: "created" }),
        } as unknown as Response;
      }
      if (url === "/api/bots") {
        botsRead += 1;
        return {
          ok: true, status: 200,
          json: async () => ({
            bots: provisioned.length > 0 && botsRead > 1 ? [readyBot, newBot] : [readyBot],
            assignments: [], roles: [role], projects: [project], canManage: true,
          }),
        } as unknown as Response;
      }
      if (init?.method === "POST" && url.includes(`/projects/${project2.id}/bots`)) {
        assigned.push(JSON.parse(String(init.body)));
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }));

    render(<BotManagerHome projectContext={project2} onFinished={() => {}} />);

    await user.click(
      await screen.findByRole("button", { name: `Select ${needsReauthAccount.displayName}` }),
    );
    await user.click(screen.getByRole("button", { name: /^add bots$/i }));

    expect(provisioned).toEqual([{
      provider: "anthropic",
      credential: "subscription_2",
      additional: true,
    }]);
    expect(assigned).toEqual([{ bots: [{ botId: newBot.id, roleId: role.id }] }]);
  });

  it("scopes the per-bot assignment dialog to the journey's project", async () => {
    const user = userEvent.setup();
    const assigned: Array<{ url: string; body: unknown }> = [];
    let finished = 0;
    stub({
      accounts: [connectedAccount],
      bots: [readyBot],
      roles: [role],
      // The fabric's first project must never become the scoped target.
      projects: [project],
      extra: (url, init) => {
        if (init?.method === "POST" && url.includes("/api/projects/")) {
          assigned.push({ url, body: JSON.parse(String(init.body)) });
          return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
        }
        return null;
      },
    });
    render(
      <BotManagerHome projectContext={project2} onFinished={() => { finished += 1; }} />,
    );

    await user.click(await screen.findByRole("button", { name: /^add to project$/i }));
    const dialog = await screen.findByRole("dialog", {
      name: /add claude builder 1 to a project/i,
    });
    expect(within(dialog).getByText(project2.name)).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: /^project$/i })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: /^add to project$/i }));

    expect(assigned).toEqual([{
      url: `/api/projects/${project2.id}/bots`,
      body: { bots: [{ botId: readyBot.id, roleId: role.id }] },
    }]);
    expect(finished).toBe(1);
  });

  it("keeps account and bot management but exposes no assignment path without a project", async () => {
    const user = userEvent.setup();
    const projectPosts: string[] = [];
    stub({
      accounts: [connectedAccount],
      bots: [readyBot],
      roles: [role],
      projects: [project],
      extra: (url, init) => {
        if (init?.method === "POST" && url.includes("/api/projects/")) {
          projectPosts.push(url);
          return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
        }
        return null;
      },
    });
    render(<BotManagerHome projectContext={null} />);

    expect(await screen.findByRole("button", { name: /add ai account/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create bot/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Rename ${readyBot.name}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Remove ${readyBot.name}` })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: `Select ${readyBot.name}` })).toBeNull();
    expect(screen.queryByRole("button", { name: /^add to project$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add \d+ to a project/i })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /^project$/i })).toBeNull();

    // Account selection still supports creating bots; it does not reveal the
    // fabric's unrelated project as an assignment target.
    await user.click(
      await screen.findByRole("button", { name: `Select ${connectedAccount.displayName}` }),
    );
    expect(screen.getByRole("button", { name: /create 1 bot/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^add bots$/i })).toBeNull();
    expect(projectPosts).toEqual([]);
  });

  it("asks for a project when there is no journey to supply one", async () => {
    const user = userEvent.setup();
    stub({ accounts: [connectedAccount], bots: [readyBot], roles: [role], projects: [project] });
    render(<BotManagerHome />);

    await user.click(await screen.findByRole("button", { name: `Select ${readyBot.name}` }));
    // No project in hand, so no in-place Add Bots — the dialog asks.
    expect(screen.queryByRole("button", { name: /^add bots$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /add to project/i })).toBeInTheDocument();
  });
});
