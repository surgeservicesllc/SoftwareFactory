// @vitest-environment node

import { describe, expect, it } from "vitest";

import { DEFAULT_BACKOFF, realSleep, retryDelayMs } from "@/lib/graph/backoff";

/** No jitter, so the schedule itself is what is being asserted. */
const FIXED = { ...DEFAULT_BACKOFF, jitter: 0 };

describe("retry backoff", () => {
  it("does not delay the first attempt", () => {
    expect(retryDelayMs(1, FIXED)).toBe(0);
    expect(retryDelayMs(0, FIXED)).toBe(0);
  });

  it("doubles from the second attempt onward", () => {
    expect(retryDelayMs(2, FIXED)).toBe(2_000);
    expect(retryDelayMs(3, FIXED)).toBe(4_000);
    expect(retryDelayMs(4, FIXED)).toBe(8_000);
    expect(retryDelayMs(5, FIXED)).toBe(16_000);
  });

  it("stops at the cap rather than growing past the graph's whole budget", () => {
    // Doubling without a ceiling eventually exceeds the duration budget, which
    // would turn a retry policy into a budget stop.
    expect(retryDelayMs(6, FIXED)).toBe(30_000);
    expect(retryDelayMs(20, FIXED)).toBe(30_000);
    expect(retryDelayMs(500, FIXED)).toBe(30_000);
  });

  it("keeps the cap a real ceiling by jittering downward", () => {
    // Jitter that added would make "never more than thirty seconds" false.
    for (const random of [0, 0.5, 0.999]) {
      expect(retryDelayMs(9, DEFAULT_BACKOFF, () => random)).toBeLessThanOrEqual(30_000);
    }
  });

  it("spreads siblings that failed together, and is otherwise deterministic", () => {
    // Four fan-out nodes that hit the same rate limit would retry in lockstep
    // without this, which is the herd a fan-out engine is most likely to form.
    const spread = new Set([0.1, 0.4, 0.7, 0.95].map(
      (random) => retryDelayMs(3, DEFAULT_BACKOFF, () => random),
    ));
    expect(spread.size).toBe(4);

    // Same inputs, same answer: the randomness is a parameter, not ambient.
    expect(retryDelayMs(3, DEFAULT_BACKOFF, () => 0.4))
      .toBe(retryDelayMs(3, DEFAULT_BACKOFF, () => 0.4));
  });

  it("never returns a negative or fractional delay", () => {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const delay = retryDelayMs(attempt, DEFAULT_BACKOFF, () => 0.999);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });

  it("resolves immediately for a delay of zero rather than queuing a timer", async () => {
    const before = Date.now();
    await realSleep(0);
    expect(Date.now() - before).toBeLessThan(50);
  });
});
