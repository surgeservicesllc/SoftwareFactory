import { describe, expect, it } from "vitest";

import {
  budgetActionIsNotable,
  budgetActionLabel,
  formatCost,
  formatTokens,
} from "@/lib/graph/run-spend";

describe("formatCost", () => {
  it("reads micro-dollars as money", () => {
    expect(formatCost(2_407_311)).toBe("$2.41");
    expect(formatCost(1_000_000)).toBe("$1.00");
    expect(formatCost(12_345_678_900)).toBe("$12,345.68");
  });

  it("keeps precision below a cent rather than rounding it away", () => {
    // A run that cost $0.0031 did not cost nothing.
    expect(formatCost(3_100)).toBe("$0.0031");
  });

  it("answers null for a run that recorded nothing, never $0.00", () => {
    // The distinction the whole module exists for: no measurement is not a
    // measurement of zero.
    expect(formatCost(null)).toBeNull();
    expect(formatCost(undefined)).toBeNull();
    expect(formatCost(Number.NaN)).toBeNull();
    // A recorded zero is still a reading, and reads as one.
    expect(formatCost(0)).toBe("$0.00");
  });
});

describe("formatTokens", () => {
  it("groups digits", () => {
    expect(formatTokens(128_450)).toBe("128,450");
    expect(formatTokens(0)).toBe("0");
  });

  it("answers null when nothing was recorded", () => {
    expect(formatTokens(null)).toBeNull();
    expect(formatTokens(undefined)).toBeNull();
  });
});

describe("budgetActionLabel", () => {
  it("says what happened, not the enum", () => {
    expect(budgetActionLabel("CONTINUE")).toBe("Ran within budget");
    expect(budgetActionLabel("REDUCE_CONCURRENCY")).toBe("Slowed down to stay in budget");
    expect(budgetActionLabel("PREFER_CHEAPER_MODEL")).toBe("Switched to a cheaper model");
    expect(budgetActionLabel("STOP_GRACEFULLY")).toBe("Stopped on budget");
  });

  it("shows an action it does not recognize rather than hiding it", () => {
    expect(budgetActionLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("answers null when no action was recorded", () => {
    expect(budgetActionLabel(null)).toBeNull();
    expect(budgetActionLabel("")).toBeNull();
  });
});

describe("budgetActionIsNotable", () => {
  it("marks only the actions that changed how the run ran", () => {
    expect(budgetActionIsNotable("REDUCE_CONCURRENCY")).toBe(true);
    expect(budgetActionIsNotable("PREFER_CHEAPER_MODEL")).toBe(true);
    expect(budgetActionIsNotable("STOP_GRACEFULLY")).toBe(true);
    expect(budgetActionIsNotable("CONTINUE")).toBe(false);
    expect(budgetActionIsNotable(null)).toBe(false);
  });
});
