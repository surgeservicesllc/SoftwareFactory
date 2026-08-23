import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiAccountConnect } from "@/components/ai-account-connect";

const oldSession = {
  id: "old-session",
  accountId: "account-1",
  status: "failed",
  loginUrl: null,
  failureReason: "Provider sign-in failed.",
  heartbeatAt: null,
  expiresAt: "2026-08-22T12:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AiAccountConnect retry and cancellation", () => {
  it("cancels the previous broker session before a retry starts a fresh one", async () => {
    const calls: string[] = [];
    let starts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url === "/api/ai-accounts/connect") {
        starts += 1;
        return {
          ok: true,
          json: async () => ({ sessionId: starts === 1 ? "old-session" : "new-session" }),
        } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session" && method === "GET") {
        return { ok: true, json: async () => ({ session: oldSession }) } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session/cancel") {
        return { ok: true, json: async () => ({ cancelled: false }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          session: { ...oldSession, id: "new-session", status: "pending", failureReason: null },
        }),
      } as Response;
    }));
    const user = userEvent.setup();

    render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={() => undefined}
        onFallback={() => undefined}
        onClose={() => undefined}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /try again/i }));
    await waitFor(() => expect(starts).toBe(2));

    const cancelIndex = calls.indexOf("POST /api/ai-accounts/sessions/old-session/cancel");
    const secondStartIndex = calls.lastIndexOf("POST /api/ai-accounts/connect");
    expect(cancelIndex).toBeGreaterThan(-1);
    expect(secondStartIndex).toBeGreaterThan(cancelIndex);
  });

  it("keeps the sign-in visible when cancellation is not confirmed", async () => {
    const onClose = vi.fn();
    let closeGuard: (() => Promise<boolean>) | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ai-accounts/connect") {
        return { ok: true, json: async () => ({ sessionId: "old-session" }) } as Response;
      }
      if (url.endsWith("/cancel") && init?.method === "POST") {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: "The broker is unavailable." } }),
        } as Response;
      }
      return { ok: true, json: async () => ({ session: oldSession }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={() => undefined}
        onFallback={() => undefined}
        onClose={onClose}
        onBeforeCloseChange={(nextGuard) => { closeGuard = nextGuard; }}
      />,
    );

    await screen.findByRole("button", { name: /^cancel$/i });
    await waitFor(() => expect(closeGuard).not.toBeNull());
    await act(async () => { expect(await closeGuard!()).toBe(false); });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai-accounts/sessions/old-session/cancel",
      { method: "POST", keepalive: true },
    ));
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText(/sign-in is still active because it could not be cancelled/i))
      .toBeInTheDocument();
  });

  it("waits for an in-flight start and cancels its exact session before an embedded owner closes", async () => {
    let releaseStart!: (response: Response) => void;
    const pendingStart = new Promise<Response>((resolve) => { releaseStart = resolve; });
    const calls: string[] = [];
    let closeGuard: (() => Promise<boolean>) | null = null;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url === "/api/ai-accounts/connect") return pendingStart;
      if (url === "/api/ai-accounts/sessions/starting-session/cancel") {
        return { ok: true, json: async () => ({ cancelled: true }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          session: { ...oldSession, id: "starting-session", status: "pending", failureReason: null },
        }),
      } as Response;
    }));

    render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={() => undefined}
        onFallback={() => undefined}
        onClose={() => undefined}
        onBeforeCloseChange={(nextGuard) => { closeGuard = nextGuard; }}
      />,
    );

    await waitFor(() => expect(calls).toContain("POST /api/ai-accounts/connect"));
    await waitFor(() => expect(closeGuard).not.toBeNull());

    let settled = false;
    const closeResult = closeGuard!().then((result) => {
      settled = true;
      return result;
    });
    await act(async () => { await Promise.resolve(); });
    expect(settled).toBe(false);
    expect(calls.some((call) => call.endsWith("/cancel"))).toBe(false);

    await act(async () => {
      releaseStart({
        ok: true,
        json: async () => ({ sessionId: "starting-session" }),
      } as Response);
    });

    await expect(closeResult).resolves.toBe(true);
    expect(calls).toContain("POST /api/ai-accounts/sessions/starting-session/cancel");
  });

  it("coalesces a double retry into one replacement session", async () => {
    const releaseCancel = deferred<Response>();
    let starts = 0;
    let oldCancels = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/ai-accounts/connect") {
        starts += 1;
        return {
          ok: true,
          json: async () => ({ sessionId: starts === 1 ? "old-session" : "new-session" }),
        } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session" && method === "GET") {
        return { ok: true, json: async () => ({ session: oldSession }) } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session/cancel") {
        oldCancels += 1;
        return releaseCancel.promise;
      }
      if (url === "/api/ai-accounts/sessions/new-session/cancel") {
        return { ok: true, json: async () => ({ cancelled: true }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          session: { ...oldSession, id: "new-session", status: "pending", failureReason: null },
        }),
      } as Response;
    }));

    render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={() => undefined}
        onFallback={() => undefined}
        onClose={() => undefined}
      />,
    );

    const retry = await screen.findByRole("button", { name: /try again/i });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(oldCancels).toBe(1));
    expect(starts).toBe(1);

    await act(async () => {
      releaseCancel.resolve({ ok: true, json: async () => ({ cancelled: true }) } as Response);
    });
    await waitFor(() => expect(starts).toBe(2));
    expect(oldCancels).toBe(1);
  });

  it("lets close win a retry whose replacement start is still in flight", async () => {
    const replacementStart = deferred<Response>();
    const calls: string[] = [];
    let starts = 0;
    let closeGuard: (() => Promise<boolean>) | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url === "/api/ai-accounts/connect") {
        starts += 1;
        if (starts === 2) return replacementStart.promise;
        return { ok: true, json: async () => ({ sessionId: "old-session" }) } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session" && method === "GET") {
        return { ok: true, json: async () => ({ session: oldSession }) } as Response;
      }
      if (url.endsWith("/cancel")) {
        return { ok: true, json: async () => ({ cancelled: true }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          session: { ...oldSession, id: "new-session", status: "pending", failureReason: null },
        }),
      } as Response;
    }));

    render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={() => undefined}
        onFallback={() => undefined}
        onClose={() => undefined}
        onBeforeCloseChange={(nextGuard) => { closeGuard = nextGuard; }}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));
    await waitFor(() => expect(starts).toBe(2));
    await waitFor(() => expect(closeGuard).not.toBeNull());
    let closeSettled = false;
    const closeResult = closeGuard!().then((result) => {
      closeSettled = true;
      return result;
    });
    await act(async () => { await Promise.resolve(); });
    expect(closeSettled).toBe(false);

    await act(async () => {
      replacementStart.resolve({
        ok: true,
        json: async () => ({ sessionId: "new-session" }),
      } as Response);
    });

    await expect(closeResult).resolves.toBe(true);
    expect(calls).toContain("POST /api/ai-accounts/sessions/old-session/cancel");
    expect(calls).toContain("POST /api/ai-accounts/sessions/new-session/cancel");
  });

  it("ignores a late poll from the old generation after retry", async () => {
    const stalePoll = deferred<Response>();
    let oldReads = 0;
    let starts = 0;
    let intervalCallback: (() => void) | null = null;
    let now = 1_000;
    const onConnected = vi.fn();
    let closeGuard: (() => Promise<boolean>) | null = null;
    const realSetInterval = window.setInterval.bind(window) as (
      handler: TimerHandler,
      timeout?: number,
    ) => number;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(window, "setInterval").mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
    ) => {
      if (timeout === 3_000) intervalCallback = handler as () => void;
      return realSetInterval(handler, timeout);
    }) as unknown as typeof window.setInterval);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/ai-accounts/connect") {
        starts += 1;
        return {
          ok: true,
          json: async () => ({ sessionId: starts === 1 ? "old-session" : "new-session" }),
        } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session" && method === "GET") {
        oldReads += 1;
        if (oldReads === 3) return stalePoll.promise;
        return {
          ok: true,
          json: async () => ({
            session: { ...oldSession, status: "pending", failureReason: null },
          }),
        } as Response;
      }
      if (url.endsWith("/cancel")) {
        return { ok: true, json: async () => ({ cancelled: true }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          session: { ...oldSession, id: "new-session", status: "pending", failureReason: null },
        }),
      } as Response;
    }));

    render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={onConnected}
        onFallback={() => undefined}
        onClose={() => undefined}
        onBeforeCloseChange={(nextGuard) => { closeGuard = nextGuard; }}
      />,
    );

    await waitFor(() => expect(oldReads).toBe(1));
    now = 77_001;
    await act(async () => { intervalCallback?.(); });
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
    act(() => { intervalCallback?.(); });
    await waitFor(() => expect(oldReads).toBe(3));

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(starts).toBe(2));
    await act(async () => {
      stalePoll.resolve({
        ok: true,
        json: async () => ({ session: { ...oldSession, status: "connected" } }),
      } as Response);
    });

    expect(onConnected).not.toHaveBeenCalled();
    await waitFor(() => expect(closeGuard).not.toBeNull());
    await expect(closeGuard!()).resolves.toBe(true);
  });

  it("cancels the exact active session when its parent unmounts directly", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url === "/api/ai-accounts/connect") {
        return { ok: true, json: async () => ({ sessionId: "old-session" }) } as Response;
      }
      if (url.endsWith("/cancel")) {
        return { ok: true, json: async () => ({ cancelled: true }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          session: { ...oldSession, status: "pending", failureReason: null },
        }),
      } as Response;
    }));

    const { unmount } = render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={() => undefined}
        onFallback={() => undefined}
        onClose={() => undefined}
      />,
    );
    await waitFor(() => expect(calls).toContain("GET /api/ai-accounts/sessions/old-session"));
    unmount();
    await waitFor(() => expect(calls).toContain(
      "POST /api/ai-accounts/sessions/old-session/cancel",
    ));
  });

  it("waits for an in-flight start and cancels the returned id after direct unmount", async () => {
    const pendingStart = deferred<Response>();
    const calls: string[] = [];
    const onConnected = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url === "/api/ai-accounts/connect") return pendingStart.promise;
      if (url.endsWith("/cancel")) {
        return { ok: true, json: async () => ({ cancelled: true }) } as Response;
      }
      return { ok: true, json: async () => ({ session: oldSession }) } as Response;
    }));

    const { unmount } = render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={onConnected}
        onFallback={() => undefined}
        onClose={() => undefined}
      />,
    );
    await waitFor(() => expect(calls).toContain("POST /api/ai-accounts/connect"));
    unmount();
    await act(async () => {
      pendingStart.resolve({
        ok: true,
        json: async () => ({ sessionId: "starting-session" }),
      } as Response);
    });

    await waitFor(() => expect(calls).toContain(
      "POST /api/ai-accounts/sessions/starting-session/cancel",
    ));
    expect(calls).not.toContain("GET /api/ai-accounts/sessions/starting-session");
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("ignores a confirmation-code error body that finishes after close and unmount", async () => {
    const errorBody = deferred<{ error: { message: string } }>();
    let codePosts = 0;
    let closeGuard: (() => Promise<boolean>) | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/ai-accounts/connect") {
        return { ok: true, json: async () => ({ sessionId: "old-session" }) } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session" && method === "GET") {
        return {
          ok: true,
          json: async () => ({
            session: {
              ...oldSession,
              status: "awaiting_user",
              failureReason: null,
            },
          }),
        } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session/code") {
        codePosts += 1;
        return { ok: false, json: () => errorBody.promise } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session/cancel") {
        return { ok: true, json: async () => ({ cancelled: true }) } as Response;
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));
    const user = userEvent.setup();
    const { unmount } = render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={() => undefined}
        onFallback={() => undefined}
        onClose={() => undefined}
        onBeforeCloseChange={(nextGuard) => { closeGuard = nextGuard; }}
      />,
    );

    const code = await screen.findByPlaceholderText(/paste the confirmation code/i);
    await user.type(code, "confirmation-code");
    await user.click(screen.getByRole("button", { name: /finish connecting/i }));
    await waitFor(() => expect(codePosts).toBe(1));
    await waitFor(() => expect(closeGuard).not.toBeNull());
    await expect(closeGuard!()).resolves.toBe(true);
    unmount();

    await act(async () => {
      errorBody.resolve({ error: { message: "This stale error must stay invisible." } });
    });
    expect(screen.queryByText(/stale error must stay invisible/i)).not.toBeInTheDocument();
  });

  it("ignores a delayed device-code clipboard result after the session closes", async () => {
    const clipboardWrite = deferred<void>();
    const user = userEvent.setup();
    const writeText = vi.spyOn(window.navigator.clipboard, "writeText")
      .mockImplementation(() => clipboardWrite.promise);
    let closeGuard: (() => Promise<boolean>) | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/ai-accounts/connect") {
        return { ok: true, json: async () => ({ sessionId: "old-session" }) } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session" && method === "GET") {
        return {
          ok: true,
          json: async () => ({
            session: {
              ...oldSession,
              status: "awaiting_user",
              failureReason: null,
              loginUrl: "https://auth.openai.com/codex/device#sf-device-code=ABCD-EFGH",
            },
          }),
        } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session/cancel") {
        return { ok: true, json: async () => ({ cancelled: true }) } as Response;
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));
    render(
      <AiAccountConnect
        providerId="openai"
        providerLabel="Codex"
        onConnected={() => undefined}
        onFallback={() => undefined}
        onClose={() => undefined}
        onBeforeCloseChange={(nextGuard) => { closeGuard = nextGuard; }}
      />,
    );

    const copy = await screen.findByRole("button", { name: /^copy$/i });
    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith("ABCD-EFGH");
    await waitFor(() => expect(closeGuard).not.toBeNull());
    await expect(closeGuard!()).resolves.toBe(true);

    await act(async () => { clipboardWrite.resolve(); });
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^copied$/i })).not.toBeInTheDocument();
  });

  it("keeps a stalled verification truthful when retry cancellation fails", async () => {
    let now = 1_000;
    let intervalCallback: (() => void) | null = null;
    let reads = 0;
    let cancelCalls = 0;
    const realSetInterval = window.setInterval.bind(window) as (
      handler: TimerHandler,
      timeout?: number,
    ) => number;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(window, "setInterval").mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
    ) => {
      if (timeout === 3_000) intervalCallback = handler as () => void;
      return realSetInterval(handler, timeout);
    }) as unknown as typeof window.setInterval);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/ai-accounts/connect") {
        return { ok: true, json: async () => ({ sessionId: "old-session" }) } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session" && method === "GET") {
        reads += 1;
        return {
          ok: true,
          json: async () => ({
            session: { ...oldSession, status: "verifying", failureReason: null },
          }),
        } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session/cancel") {
        cancelCalls += 1;
        return {
          ok: false,
          json: async () => ({ error: { message: "Cancellation unavailable." } }),
        } as Response;
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));
    const user = userEvent.setup();
    render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={() => undefined}
        onFallback={() => undefined}
        onClose={() => undefined}
      />,
    );

    await waitFor(() => expect(reads).toBe(1));
    now = 152_001;
    await act(async () => { intervalCallback?.(); });
    const stalled = await screen.findByRole("heading", { name: /verification didn't finish/i });
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(cancelCalls).toBe(1));

    expect(stalled).toBeInTheDocument();
    expect(screen.getByText(/sign-in is still active because it could not be cancelled/i))
      .toBeInTheDocument();
  });

  it("coalesces two Cancel signals into one server cancellation and one owner close", async () => {
    const releaseCancel = deferred<Response>();
    const onClose = vi.fn();
    let cancelCalls = 0;
    let oldReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/ai-accounts/connect") {
        return { ok: true, json: async () => ({ sessionId: "old-session" }) } as Response;
      }
      if (url === "/api/ai-accounts/sessions/old-session" && method === "GET") {
        oldReads += 1;
        return { ok: true, json: async () => ({ session: oldSession }) } as Response;
      }
      if (url.endsWith("/cancel")) {
        cancelCalls += 1;
        return releaseCancel.promise;
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));

    render(
      <AiAccountConnect
        providerId="anthropic"
        providerLabel="Claude"
        onConnected={() => undefined}
        onFallback={() => undefined}
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(oldReads).toBe(1));
    const cancelButton = await screen.findByRole("button", { name: /^cancel$/i });
    fireEvent.click(cancelButton);
    fireEvent.click(cancelButton);
    await waitFor(() => expect(cancelCalls).toBe(1));
    await act(async () => {
      releaseCancel.resolve({ ok: true, json: async () => ({ cancelled: true }) } as Response);
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(cancelCalls).toBe(1);
  });
});
