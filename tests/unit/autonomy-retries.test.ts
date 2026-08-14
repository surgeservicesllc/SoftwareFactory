import { describe, expect, it } from "vitest";

import { MAX_ATTEMPTS, evaluateRetry, isRetryableStage } from "@/lib/autonomy/retries";

describe("the caps themselves", () => {
  it("bounds every retryable stage", () => {
    for (const [stage, limit] of Object.entries(MAX_ATTEMPTS)) {
      expect(limit, `${stage} must be bounded`).toBeGreaterThan(0);
      expect(limit, `${stage} must not be unbounded`).toBeLessThanOrEqual(3);
    }
  });

  it("matches the repair cap Phase 1E enforces in the database", () => {
    expect(MAX_ATTEMPTS.repair).toBe(3);
  });

  it("recognizes only real stages", () => {
    expect(isRetryableStage("verify")).toBe(true);
    expect(isRetryableStage("deploy")).toBe(false);
    expect(isRetryableStage(null)).toBe(false);
  });
});

describe("evaluateRetry", () => {
  it("allows a retry while budget remains", () => {
    const outcome = evaluateRetry("verify", 1);

    expect(outcome.decision).toBe("RETRY");
    expect(outcome.attemptsRemaining).toBe(MAX_ATTEMPTS.verify - 1);
    expect(outcome.backoffSeconds).toBeGreaterThan(0);
  });

  it("escalates instead of retrying once the budget is spent", () => {
    const outcome = evaluateRetry("verify", MAX_ATTEMPTS.verify);

    expect(outcome.decision).toBe("ESCALATE");
    expect(outcome.attemptsRemaining).toBe(0);
    expect(outcome.backoffSeconds).toBe(0);
    expect(outcome.reason).toMatch(/escalating instead of retrying/i);
  });

  it("keeps escalating past the cap rather than wrapping around", () => {
    expect(evaluateRetry("repair", 99).decision).toBe("ESCALATE");
    expect(evaluateRetry("repair", 99).attemptsRemaining).toBe(0);
  });

  it("never retries a permanent failure, even with budget left", () => {
    const outcome = evaluateRetry("implement", 0, { permanent: true });

    expect(outcome.decision).toBe("STOP");
    expect(outcome.backoffSeconds).toBe(0);
    expect(outcome.reason).toMatch(/cannot change the outcome/i);
  });

  it("backs off exponentially across the attempts that can actually retry", () => {
    // The first failure arrives as attemptsUsed = 1, so that is where the
    // schedule starts; used = 3 is the cap and escalates instead.
    expect(evaluateRetry("implement", 1).backoffSeconds).toBe(60);
    expect(evaluateRetry("implement", 2).backoffSeconds).toBe(120);
    expect(evaluateRetry("implement", 3).decision).toBe("ESCALATE");
  });

  it("keeps every backoff inside the ceiling", () => {
    for (const stage of ["implement", "verify", "review", "repair"] as const) {
      for (let used = 1; used <= MAX_ATTEMPTS[stage]; used += 1) {
        expect(evaluateRetry(stage, used).backoffSeconds).toBeLessThanOrEqual(900);
      }
    }
  });

  it("treats a negative or fractional count as the safe whole number", () => {
    expect(evaluateRetry("verify", -5).attemptsUsed).toBe(0);
    expect(evaluateRetry("verify", 1.9).attemptsUsed).toBe(1);
  });

  it("reports the budget in every outcome so a record can show it", () => {
    for (const used of [0, 1, 2, 3, 4]) {
      const outcome = evaluateRetry("repair", used);
      expect(outcome.attemptsUsed + outcome.attemptsRemaining).toBeGreaterThanOrEqual(
        MAX_ATTEMPTS.repair,
      );
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
  });
});
