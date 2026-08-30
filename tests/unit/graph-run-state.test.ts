import { describe, expect, it } from "vitest";

import {
  GRAPH_RUN_STATES,
  GRAPH_RUN_STATE_METADATA,
  graphRunStateMetadata,
  isTerminalGraphRunState,
} from "@/lib/graph/run-state";

describe("graph run state metadata", () => {
  it("is exhaustive over the durable database enum", () => {
    expect(Object.keys(GRAPH_RUN_STATE_METADATA)).toEqual(GRAPH_RUN_STATES);
  });

  it.each([
    ["PLANNED", false],
    ["RUNNING", false],
    ["PARTIAL", true],
    ["COMPLETED", true],
    ["FAILED", true],
    ["CANCELLED", true],
    ["BUDGET_STOPPED", true],
  ] as const)("classifies %s terminal=%s", (state, terminal) => {
    expect(graphRunStateMetadata(state).terminal).toBe(terminal);
    expect(isTerminalGraphRunState(state)).toBe(terminal);
  });

  it("keeps an unknown future state visible and fail-open as non-terminal", () => {
    expect(graphRunStateMetadata("NEW_STATE")).toEqual({
      label: "new state",
      terminal: false,
      tone: "neutral",
    });
  });
});
