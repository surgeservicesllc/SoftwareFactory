import { render, screen } from "@testing-library/react";
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
        json: async () => ({ bots: options.bots ?? [], assignments: [], canManage: true }),
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
    await user.click(screen.getByRole("button", { name: /rename claude account 1/i }));
    const input = screen.getByLabelText(/new name for claude account 1/i);
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

    expect(await screen.findByText("1 Connected")).toBeInTheDocument();
    expect(screen.getByText(/your ai team/i)).toBeInTheDocument();
    expect(screen.getByText("Claude Builder 1")).toBeInTheDocument();
    // No zero-state tab chrome on the primary surface.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});
