import { describe, expect, it } from "vitest";

import {
  createPhase1CExecutionPlan,
  DEFAULT_CODEX_MODEL,
  DEFAULT_PHASE_1C_BUDGET,
} from "@/lib/orchestration/plan";

describe("Phase 1C execution plan", () => {
  it.each([
    ["audit", "qa"],
    ["test", "qa"],
    ["mobile", "frontend"],
    ["security", "security"],
    ["performance", "performance"],
    ["build_feature", "architect"],
    ["fix_bug", "backend"],
    ["other", "orchestrator"],
  ] as const)("maps %s work to the %s logical agent", (commandType, expectedRole) => {
    expect(createPhase1CExecutionPlan(commandType, {})).toMatchObject({
      agentRole: expectedRole,
      budget: DEFAULT_PHASE_1C_BUDGET,
      model: DEFAULT_CODEX_MODEL,
      provider: "openai",
    });
  });

  it("accepts a bounded server-selected model name", () => {
    expect(createPhase1CExecutionPlan("audit", {
      SOFTWAREFACTORY_CODEX_MODEL: "gpt-5.3-codex",
    }).model).toBe("gpt-5.3-codex");
  });

  it.each(["../model", "model name", "", "x".repeat(121)])(
    "rejects an invalid configured model %j",
    (model) => {
      const environment = model === "" ? { SOFTWAREFACTORY_CODEX_MODEL: " " } : {
        SOFTWAREFACTORY_CODEX_MODEL: model,
      };
      if (model === "") {
        expect(createPhase1CExecutionPlan("audit", environment).model).toBe(DEFAULT_CODEX_MODEL);
      } else {
        expect(() => createPhase1CExecutionPlan("audit", environment)).toThrow(
          "SOFTWAREFACTORY_CODEX_MODEL is invalid.",
        );
      }
    },
  );
});
