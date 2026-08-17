import { describe, expect, it } from "vitest";

import {
  DEFAULT_RATE_LIMIT_POLICY,
  admitsRate,
  eventsInWindow,
  rateUsage,
  recordRequest,
  settleTokens,
  validatePolicy,
  type RateEvent,
  type RateLimitPolicy,
} from "@/lib/resources/rate-limits";

const policy: RateLimitPolicy = { windowMs: 60_000, maxRequests: 3, maxTokens: 1_000 };

function event(at: number, overrides: Partial<RateEvent> = {}): RateEvent {
  return { provider: "anthropic", at, tokens: 100, estimated: false, ...overrides };
}

describe("the sliding window", () => {
  it("counts only the provider asked about", () => {
    const events = [event(1_000), event(2_000, { provider: "openai" })];
    expect(rateUsage(events, "anthropic", 3_000, policy.windowMs).requests).toBe(1);
    // A shared window across providers would throttle one provider because a
    // different one was busy.
    expect(rateUsage(events, "openai", 3_000, policy.windowMs).requests).toBe(1);
  });

  it("treats the boundary as exclusive, so waiting the reported time actually admits", () => {
    const events = [event(1_000)];
    expect(eventsInWindow(events, "anthropic", 60_999, 60_000)).toHaveLength(1);
    expect(eventsInWindow(events, "anthropic", 61_000, 60_000)).toHaveLength(0);
  });
});

describe("request-rate refusal", () => {
  it("refuses once the window is full and admits again when it drains", () => {
    const events = [event(1_000), event(2_000), event(3_000)];
    const refused = admitsRate(events, "anthropic", 4_000, 0, policy);
    expect(refused.admitted).toBe(false);
    expect(refused.refusal).toBe("REQUEST_RATE_EXCEEDED");

    expect(admitsRate(events, "anthropic", 61_001, 0, policy).admitted).toBe(true);
  });

  it("bounds a burst that never exceeds the concurrency limit", () => {
    // The case that makes this a separate gate: short calls. Six concurrent
    // slots filled by two-second calls is 180 requests a minute while never
    // showing more than six in flight, so a concurrency cap alone never fires.
    let events: readonly RateEvent[] = [];
    let admitted = 0;
    for (let index = 0; index < 10; index += 1) {
      const at = index * 2_000;
      if (admitsRate(events, "anthropic", at, 0, policy).admitted) {
        events = recordRequest(events, event(at), policy.windowMs);
        admitted += 1;
      }
    }
    expect(admitted).toBe(policy.maxRequests);
  });

  it("reports exactly when the refusal clears, and that wait is enough", () => {
    const events = [event(1_000), event(2_000), event(3_000)];
    const verdict = admitsRate(events, "anthropic", 4_000, 0, policy);

    expect(verdict.retryAfterMs).toBe(1_000 + 60_000 - 4_000);
    // The number has to be true, not indicative: a caller that waits it and is
    // refused again backs off in a hot loop.
    const later = 4_000 + verdict.retryAfterMs!;
    expect(admitsRate(events, "anthropic", later, 0, policy).admitted).toBe(true);
  });
});

describe("token-rate refusal", () => {
  it("counts the estimate for the call being considered, not just history", () => {
    const events = [event(1_000, { tokens: 900 })];
    expect(admitsRate(events, "anthropic", 2_000, 50, policy).admitted).toBe(true);
    // 900 + 200 exceeds 1000, and it must be refused before the call is made.
    expect(admitsRate(events, "anthropic", 2_000, 200, policy).refusal).toBe("TOKEN_RATE_EXCEEDED");
  });

  it("waits for as many events as it takes to free the shortfall", () => {
    const events = [event(1_000, { tokens: 100 }), event(10_000, { tokens: 800 })];
    // Needs 400 freed; retiring the oldest frees only 100, so the wait must
    // reach the second event. Reporting the oldest would retry too early.
    const verdict = admitsRate(events, "anthropic", 11_000, 400, policy);
    expect(verdict.refusal).toBe("TOKEN_RATE_EXCEEDED");
    expect(verdict.retryAfterMs).toBe(10_000 + 60_000 - 11_000);

    const later = 11_000 + verdict.retryAfterMs!;
    expect(admitsRate(events, "anthropic", later, 400, policy).admitted).toBe(true);
  });

  it("treats a null token budget as unlimited rather than as zero", () => {
    const unlimited: RateLimitPolicy = { ...policy, maxTokens: null };
    expect(admitsRate([event(1_000, { tokens: 999_999 })], "anthropic", 2_000, 999_999, unlimited).admitted).toBe(true);
  });
});

describe("estimates are labelled, never laundered", () => {
  it("marks a window built from estimates", () => {
    const events = [event(1_000, { tokens: 500, estimated: true })];
    const usage = rateUsage(events, "anthropic", 2_000, policy.windowMs);
    expect(usage.tokens).toBe(500);
    expect(usage.tokensIncludeEstimates).toBe(true);
  });

  it("settles an estimate into a measurement without disturbing its peers", () => {
    const estimate = event(1_000, { tokens: 500, estimated: true });
    const events = [estimate, event(2_000, { tokens: 500, estimated: true })];

    const settled = settleTokens(events, estimate, 120);
    expect(settled[0]?.tokens).toBe(120);
    expect(settled[0]?.estimated).toBe(false);
    expect(settled[1]?.estimated).toBe(true);
    expect(rateUsage(settled, "anthropic", 3_000, policy.windowMs).tokensIncludeEstimates).toBe(true);
  });

  it("ignores a settlement for an event that already aged out", () => {
    const stale = event(1_000, { tokens: 500, estimated: true });
    expect(settleTokens([event(2_000)], stale, 10)).toHaveLength(1);
  });
});

describe("retained history is bounded by the window, not by uptime", () => {
  it("drops aged-out events as it records", () => {
    let events: readonly RateEvent[] = [];
    for (let index = 0; index < 100; index += 1) {
      events = recordRequest(events, event(index * 10_000), 60_000);
    }
    // Six per minute at a 10s cadence, plus the one just written.
    expect(events.length).toBeLessThanOrEqual(7);
  });
});

describe("a policy that cannot mean what it says is refused", () => {
  it("rejects a zero token budget as ambiguous but accepts null", () => {
    expect(validatePolicy({ ...policy, maxTokens: 0 })).toHaveLength(1);
    expect(validatePolicy({ ...policy, maxTokens: null })).toHaveLength(0);
  });

  it("rejects a window shorter than a second and a limit below one request", () => {
    expect(validatePolicy({ ...policy, windowMs: 10 })).toHaveLength(1);
    expect(validatePolicy({ ...policy, maxRequests: 0 })).toHaveLength(1);
  });

  it("ships a default that is declared and valid", () => {
    expect(validatePolicy(DEFAULT_RATE_LIMIT_POLICY)).toHaveLength(0);
    expect(DEFAULT_RATE_LIMIT_POLICY.maxTokens).toBeNull();
  });
});
