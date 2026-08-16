import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiAccountsPanel } from "@/components/ai-accounts-panel";

const connectedAccount = {
  id: "acc-1",
  provider: "anthropic",
  providerLabel: "Claude",
  displayName: "Claude account 1",
  status: "connected",
  lastVerifiedAt: "2026-08-16T12:00:00.000Z",
  lastError: null,
};

const reauthAccount = {
  id: "acc-2",
  provider: "anthropic",
  providerLabel: "Claude",
  displayName: "Claude account 2",
  status: "needs_reauth",
  lastVerifiedAt: null,
  lastError: "The provider refused the stored token.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubAccounts(accounts: unknown[], extra?: (url: string, init?: RequestInit) => Response | null) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const handled = extra?.(url, init);
    if (handled) return handled;
    if (url === "/api/ai-accounts") {
      return { ok: true, status: 200, json: async () => ({ accounts }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }));
}

describe("AiAccountsPanel", () => {
  it("renders nothing while the organization has no accounts", async () => {
    stubAccounts([]);
    const { container } = render(<AiAccountsPanel canManage onChanged={() => undefined} />);
    // Give the initial load a tick to resolve.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each account's honest lifecycle, and the recovery it needs", async () => {
    stubAccounts([connectedAccount, reauthAccount]);

    render(<AiAccountsPanel canManage onChanged={() => undefined} />);

    expect(await screen.findByText("Claude account 1")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Needs sign-in again")).toBeInTheDocument();
    // The stored failure reason is shown, sanitized server-side.
    expect(screen.getByText(/refused the stored token/)).toBeInTheDocument();
    // Reconnect is offered exactly where it makes sense: not on a healthy
    // account, but on the one that needs signing in again.
    expect(screen.getAllByRole("button", { name: /reconnect/i })).toHaveLength(1);
  });

  it("disconnects only after an in-place confirmation, through the credential-deleting route", async () => {
    const calls: string[] = [];
    stubAccounts([connectedAccount], (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/ai-accounts/acc-1/disconnect") {
        return { ok: true, status: 200, json: async () => ({ disconnected: true }) } as unknown as Response;
      }
      return null;
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();

    render(<AiAccountsPanel canManage onChanged={onChanged} />);

    await user.click(await screen.findByRole("button", { name: /^disconnect$/i }));
    // First click armed; nothing was posted yet.
    expect(calls).not.toContain("POST /api/ai-accounts/acc-1/disconnect");
    // The confirm states the consequence: the credential goes too.
    await user.click(screen.getByRole("button", { name: /remove its credential/i }));

    expect(calls).toContain("POST /api/ai-accounts/acc-1/disconnect");
    expect(onChanged).toHaveBeenCalled();
  });

  it("reconnects a specific account through the broker flow", async () => {
    const connectBodies: Array<Record<string, unknown>> = [];
    stubAccounts([reauthAccount], (url, init) => {
      if (url === "/api/ai-accounts/connect" && init?.method === "POST") {
        connectBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return {
          ok: true, status: 200,
          json: async () => ({ accountId: "acc-2", sessionId: "sess-9", workerWoken: false }),
        } as unknown as Response;
      }
      if (url === "/api/ai-accounts/sessions/sess-9") {
        return {
          ok: true, status: 200,
          json: async () => ({ session: {
            id: "sess-9", accountId: "acc-2", status: "pending", loginUrl: null,
            failureReason: null, heartbeatAt: null,
            expiresAt: "2026-08-16T15:00:00.000Z", updatedAt: "2026-08-16T14:00:00.000Z",
          } }),
        } as unknown as Response;
      }
      return null;
    });
    const user = userEvent.setup();

    render(<AiAccountsPanel canManage onChanged={() => undefined} />);

    await user.click(await screen.findByRole("button", { name: /reconnect/i }));

    // The broker flow starts against exactly that account.
    expect(await screen.findByText(/connecting claude/i)).toBeInTheDocument();
    expect(connectBodies[0]).toEqual({ provider: "anthropic", accountId: "acc-2" });
  });

  it("hides both actions from a read-only member", async () => {
    stubAccounts([connectedAccount, reauthAccount]);

    render(<AiAccountsPanel canManage={false} onChanged={() => undefined} />);

    expect(await screen.findByText("Claude account 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reconnect/i })).not.toBeInTheDocument();
  });
});
