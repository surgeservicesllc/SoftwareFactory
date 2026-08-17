import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BotUsageConsole } from "@/components/bot-usage-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function account(id: string, displayName: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    provider: "anthropic",
    providerLabel: "Claude Code",
    displayName,
    status: "connected",
    lastVerifiedAt: "2026-08-17T10:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BotUsageConsole", () => {
  it("renders measured windows, derives headroom from them, and averages the weekly window", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/ai-accounts") {
        return jsonResponse({
          canManage: true,
          accounts: [account("a1", "Claude One"), account("a2", "Claude Two")],
        });
      }
      if (url === "/api/ai-accounts/usage") {
        return jsonResponse({ usage: [
          {
            accountId: "a1",
            observedAt: "2026-08-17T12:00:00.000Z",
            status: "measured",
            windows: [
              { key: "session_5h", label: "Session (5h)", usedPercent: 40, resetsAt: "2026-08-17T15:00:00.000Z" },
              { key: "week_all_models", label: "Week (all models)", usedPercent: 60, resetsAt: null },
            ],
            detail: null,
          },
          {
            accountId: "a2",
            observedAt: "2026-08-17T12:00:00.000Z",
            status: "measured",
            windows: [
              { key: "week_all_models", label: "Week (all models)", usedPercent: 92, resetsAt: null },
            ],
            detail: null,
          },
        ] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<BotUsageConsole />);

    expect(await screen.findByText("Claude One")).toBeInTheDocument();
    // Two connected accounts; the average is over the week_all_models
    // windows only: (60 + 92) / 2 = 76.
    expect(screen.getByText("Bots connected").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Average weekly usage").parentElement).toHaveTextContent("76%");

    // Bands derive from the highest used window: 60% → Healthy, 92% → Low.
    const one = screen.getByText("Claude One").closest("li") as HTMLElement;
    expect(within(one).getByText("Healthy")).toBeInTheDocument();
    expect(within(one).getByRole("progressbar", { name: "Session (5h) usage" })).toHaveAttribute("aria-valuenow", "40");
    const two = screen.getByText("Claude Two").closest("li") as HTMLElement;
    expect(within(two).getByText("Low headroom")).toBeInTheDocument();

    expect(within(one).getByRole("link", { name: /view details/i })).toHaveAttribute("href", "/solutions/bot-manager");
  });

  it("names each absence instead of inventing numbers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/ai-accounts") {
        return jsonResponse({
          canManage: false,
          accounts: [
            account("a1", "Fresh Account"),
            account("a2", "Codex Account", { provider: "openai", providerLabel: "OpenAI Codex" }),
          ],
        });
      }
      if (url === "/api/ai-accounts/usage") {
        return jsonResponse({ usage: [
          {
            accountId: "a2",
            observedAt: "2026-08-17T12:00:00.000Z",
            status: "unsupported",
            windows: [],
            detail: null,
          },
        ] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<BotUsageConsole />);

    expect(await screen.findByText(/No usage recorded yet/)).toBeInTheDocument();
    expect(screen.getByText(/Usage is not measurable for this provider yet/)).toBeInTheDocument();
    expect(screen.getByText("Average weekly usage").parentElement).toHaveTextContent("—");
    // A member without manage rights gets no refresh control.
    expect(screen.queryByRole("button", { name: /refresh/i })).not.toBeInTheDocument();
  });

  it("wires Refresh to the real refresh endpoint for managers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ai-accounts") {
        return jsonResponse({ canManage: true, accounts: [account("a1", "Claude One")] });
      }
      if (url === "/api/ai-accounts/usage") return jsonResponse({ usage: [] });
      if (url === "/api/ai-accounts/refresh" && init?.method === "POST") {
        return jsonResponse({ requested: true, workerWoken: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BotUsageConsole />);

    fireEvent.click(await screen.findByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ai-accounts/refresh", { method: "POST" }));
    expect(await screen.findByText(/Refresh requested/)).toBeInTheDocument();
  });

  it("sends an empty workspace to the connect flow and gates a signed-out visitor", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/ai-accounts") return jsonResponse({ canManage: true, accounts: [] });
      if (url === "/api/ai-accounts/usage") return jsonResponse({ usage: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    const { unmount } = render(<BotUsageConsole />);
    expect(await screen.findByText("No AI accounts connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /connect a bot/i })).toHaveAttribute(
      "href",
      "/solutions/bot-manager#connect",
    );
    unmount();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));
    render(<BotUsageConsole />);
    expect(await screen.findByText("Sign in to see bot usage")).toBeInTheDocument();
  });
});
