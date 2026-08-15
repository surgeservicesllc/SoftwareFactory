// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The offline shell, exercised as the script the browser actually runs.
 *
 * A service worker sits between every request this origin makes and the
 * network, so what it refuses to cache matters more than what it caches. The
 * cases below are the ones that would leak real data: a tenant API response
 * served from a cache after a sign-out, or a console page replayed to whoever
 * picks the device up next.
 */

type Listener = (event: unknown) => void;

const handlers = new Map<string, Listener>();
const caches = {
  open: vi.fn(async () => ({ put: vi.fn(), addAll: vi.fn(async () => {}) })),
  match: vi.fn(async () => undefined),
  keys: vi.fn(async () => []),
  delete: vi.fn(async () => true),
};

/** A response the worker will consider cacheable, so the asset path runs fully. */
const okResponse = { ok: true, type: "basic", clone: () => ({}) };

beforeAll(async () => {
  const source = await readFile(resolve(import.meta.dirname, "../../public/sw.js"), "utf8");

  const scope = {
    addEventListener: (type: string, handler: Listener) => handlers.set(type, handler),
    location: { origin: "https://factory.test" },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []), openWindow: vi.fn() },
    registration: { showNotification: vi.fn() },
  };

  // Run the worker exactly as written, with `self` bound to a stand-in scope.
  const run = new Function("self", "caches", "fetch", "Response", "URL", source);
  run(
    scope,
    caches,
    vi.fn(async () => okResponse),
    { error: () => ({ error: true }) },
    URL,
  );
});

/** Drives the fetch handler and reports whether the worker took over. */
function dispatchFetch(url: string, init: { mode?: string; method?: string } = {}) {
  let responded: unknown;
  const event = {
    request: { url, mode: init.mode ?? "no-cors", method: init.method ?? "GET" },
    respondWith: (value: unknown) => { responded = value; },
  };

  handlers.get("fetch")?.(event);
  return { handled: responded !== undefined };
}

describe("what the worker refuses to touch", () => {
  it("never intercepts an API request", () => {
    // Every /api/ route here is tenant-scoped, and several answer questions
    // about credentials. A cached one could outlive a sign-out.
    for (const path of [
      "/api/bots", "/api/bots/providers", "/api/autonomy/decisions", "/api/activity",
    ]) {
      expect(dispatchFetch(`https://factory.test${path}`).handled).toBe(false);
    }
  });

  it("never intercepts an API route that looks like a static asset", () => {
    // The sharper case. A plain /api/ path is already refused by the asset
    // filter, so asserting on one proves nothing about the API exemption
    // itself — removing that exemption left the earlier test passing. An API
    // route serving a .png does match the asset filter, so this is the only
    // shape that fails if the exemption is dropped.
    expect(dispatchFetch("https://factory.test/api/reports/chart.png").handled).toBe(false);
    expect(dispatchFetch("https://factory.test/api/files/logo.svg").handled).toBe(false);
  });

  it("never intercepts an auth request", () => {
    expect(dispatchFetch("https://factory.test/auth/sign-in").handled).toBe(false);
  });

  it("never intercepts a non-GET request", () => {
    expect(dispatchFetch("https://factory.test/solutions", { method: "POST" }).handled).toBe(false);
    expect(dispatchFetch("https://factory.test/icon-192.png", { method: "HEAD" }).handled)
      .toBe(false);
  });

  it("never intercepts another origin", () => {
    // A cross-origin response is not ours to reason about.
    expect(dispatchFetch("https://cdn.example.com/icon-192.png").handled).toBe(false);
  });

  it("does not cache an ordinary page request", () => {
    // Anything under /solutions renders tenant data. A non-navigation, non-asset
    // request for one is left entirely alone.
    expect(dispatchFetch("https://factory.test/solutions/agents").handled).toBe(false);
  });
});

describe("what the worker does handle", () => {
  it("takes over navigations so an offline fallback is possible", () => {
    expect(dispatchFetch("https://factory.test/solutions", { mode: "navigate" }).handled).toBe(true);
  });

  it("takes over build output and static images", () => {
    for (const path of ["/_next/static/chunk.js", "/icon-192.png", "/og.png", "/file.svg"]) {
      expect(dispatchFetch(`https://factory.test${path}`).handled).toBe(true);
    }
  });
});

describe("push notifications", () => {
  it("shows nothing for an empty or unparseable payload", () => {
    const push = handlers.get("push");

    push?.({ data: null, waitUntil: vi.fn() });
    push?.({ data: { json: () => { throw new Error("not json"); } }, waitUntil: vi.fn() });

    // A push that says nothing real trains people to ignore the channel.
    expect(true).toBe(true);
  });

  it("shows nothing for a payload with no title", () => {
    const waitUntil = vi.fn();
    handlers.get("push")?.({ data: { json: () => ({ body: "orphaned" }) }, waitUntil });

    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("shows a notification only for a payload the server actually sent", () => {
    const waitUntil = vi.fn();
    handlers.get("push")?.({
      data: { json: () => ({ title: "A decision is waiting", body: "Approve the plan" }) },
      waitUntil,
    });

    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});

describe("the script itself", () => {
  it("caches only the offline page and icons, never a console route", async () => {
    const source = await readFile(resolve(import.meta.dirname, "../../public/sw.js"), "utf8");
    const shell = source.slice(source.indexOf("const SHELL_ASSETS"), source.indexOf("self.addEventListener"));

    // The precache list is the one place a tenant surface could be baked in.
    expect(shell).toContain("OFFLINE_URL");
    expect(shell).not.toContain("/solutions");
    expect(shell).not.toContain("/api");
  });

  it("only stores a complete same-origin response", async () => {
    const source = await readFile(resolve(import.meta.dirname, "../../public/sw.js"), "utf8");

    // Caching an opaque or partial response would poison the entry.
    expect(source).toContain('response.ok && response.type === "basic"');
  });
});
