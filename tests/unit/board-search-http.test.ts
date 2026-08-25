// @vitest-environment node

import { describe, expect, it } from "vitest";

import { fetchBoardJson, htmlToText, SEARCH_DEADLINE_MS, USER_AGENT } from "@/lib/job-seeker/board-search/http";
import { BoardSearchError } from "@/lib/job-seeker/board-search/types";

/**
 * The retry budget, driven by a fake clock.
 *
 * This is the piece that deliberately diverges from the source CLIs: they
 * retried six times with a 15s attempt timeout, which can exceed a minute.
 * That is right for a terminal and wrong inside a request a person is
 * watching. What is asserted here is the property that replaced it — the
 * whole operation is bounded by a wall-clock deadline — rather than a retry
 * count, because the count is the thing that was wrong.
 */

function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => { current += ms; },
    advance: (ms: number) => { current += ms; },
  };
}

function respondWith(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("the board fetch budget", () => {
  it("returns the first good answer without sleeping", async () => {
    const clock = fakeClock();
    let calls = 0;
    const data = await fetchBoardJson<{ ok: boolean }>("https://example.test/x", {
      board: "jobnet",
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0,
      fetchImpl: async () => { calls += 1; return respondWith(200, { ok: true }); },
    });
    expect(data).toEqual({ ok: true });
    expect(calls).toBe(1);
    expect(clock.now()).toBe(0);
  });

  it("retries a 429 and succeeds", async () => {
    const clock = fakeClock();
    let calls = 0;
    const data = await fetchBoardJson<{ ok: boolean }>("https://example.test/x", {
      board: "jobnet",
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? respondWith(429) : respondWith(200, { ok: true });
      },
    });
    expect(data).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(clock.now()).toBeGreaterThan(0);
  });

  it("stops at the deadline instead of retrying a fixed number of times", async () => {
    const clock = fakeClock();
    let calls = 0;
    await expect(
      fetchBoardJson("https://example.test/x", {
        board: "jobnet",
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        fetchImpl: async () => { calls += 1; return respondWith(503); },
      }),
    ).rejects.toBeInstanceOf(BoardSearchError);

    // The property that matters: a person waits no longer than the stated
    // budget, whatever number of attempts fits inside it.
    expect(clock.now()).toBeLessThanOrEqual(SEARCH_DEADLINE_MS);
    expect(calls).toBeGreaterThan(1);
  });

  it("says a rate limit is a rate limit, so retrying later is legible", async () => {
    const clock = fakeClock();
    await expect(
      fetchBoardJson("https://example.test/x", {
        board: "jobindex",
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        fetchImpl: async () => respondWith(429),
      }),
    ).rejects.toThrow(/rate limiting/i);
  });

  it("does not retry a 4xx, because repeating a rejected request earns a block", async () => {
    let calls = 0;
    await expect(
      fetchBoardJson("https://example.test/x", {
        board: "jobnet",
        fetchImpl: async () => { calls += 1; return respondWith(400); },
      }),
    ).rejects.toThrow(/refused the request \(400\)/);
    expect(calls).toBe(1);
  });

  it("reports a network failure as the board not answering, without leaking internals", async () => {
    const clock = fakeClock();
    const error = await fetchBoardJson("https://example.test/x", {
      board: "jobnet",
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0,
      fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND internal-host.local"); },
    }).then(() => null).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BoardSearchError);
    if (!(error instanceof BoardSearchError)) return;
    expect(error.code).toBe("board_unreachable");
    // A hostname from a stack trace has no business on a job search page.
    expect(error.message).not.toContain("ENOTFOUND");
    expect(error.message).not.toContain("internal-host");
  });

  it("identifies itself so a board operator can recognise this traffic", async () => {
    let sent: string | null = null;
    await fetchBoardJson("https://example.test/x", {
      board: "jobnet",
      fetchImpl: async (_url, init) => {
        sent = new Headers(init?.headers).get("User-Agent");
        return respondWith(200);
      },
    });
    expect(sent).toBe(USER_AGENT);
    expect(sent).toContain("SoftwareFactoryJobSeeker");
  });

  it("calls a non-JSON answer unreadable rather than crashing", async () => {
    await expect(
      fetchBoardJson("https://example.test/x", {
        board: "jobindex",
        fetchImpl: async () => new Response("<html>maintenance</html>", { status: 200 }),
      }),
    ).rejects.toThrow(/not JSON/i);
  });
});

describe("turning board HTML into stored text", () => {
  it("keeps words apart across tags and entities", () => {
    expect(htmlToText("<p>Kubernetes</p><p>depth</p>")).toBe("Kubernetes\ndepth");
    expect(htmlToText("a&nbsp;b")).toBe("a b");
    expect(htmlToText("<b>Go</b>&amp;<b>Rust</b>")).toBe("Go & Rust");
  });

  it("answers null for nothing, so an absent description stays absent", () => {
    // Not "" — job_seeker_jobs.description is nullable and an empty string
    // renders as a description that exists and says nothing.
    expect(htmlToText(null)).toBeNull();
    expect(htmlToText("   <p> </p> ")).toBeNull();
  });
});
