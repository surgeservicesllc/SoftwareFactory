import { describe, expect, it } from "vitest";

import {
  classifyFactoryCommandExecutionIdentity,
  createFactoryCommandExecutionIntent,
  createPhase1CExecutionPlan,
  DEFAULT_CODEX_MODEL,
  DEFAULT_PHASE_1C_BUDGET,
  FACTORY_RECORD_ONLY_PLAN,
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

  it("keeps the exact Codex posting on the manual Phase 1C path", () => {
    const phase1CPlan = createPhase1CExecutionPlan("fix_bug", {});

    expect(createFactoryCommandExecutionIntent({
      model: DEFAULT_CODEX_MODEL,
      phase1CPlan,
      provider: "openai",
    })).toMatchObject({
      executionMode: "manual",
      model: DEFAULT_CODEX_MODEL,
      plan: phase1CPlan.plan,
      provider: "openai",
    });
  });

  it("records a non-Codex posting without creating executable work", () => {
    const phase1CPlan = createPhase1CExecutionPlan("fix_bug", {});

    expect(createFactoryCommandExecutionIntent({
      model: "claude-opus-5",
      phase1CPlan,
      provider: "anthropic",
    })).toEqual({
      executionMode: "record_only",
      model: "claude-opus-5",
      plan: FACTORY_RECORD_ONLY_PLAN,
      provider: "anthropic",
    });
  });

  it("rejects providers and OpenAI models outside the two reviewed lanes", () => {
    expect(classifyFactoryCommandExecutionIdentity({
      model: "gemini-pro",
      provider: "google",
    })).toBeNull();
    expect(classifyFactoryCommandExecutionIdentity({
      model: "gpt-5.3",
      provider: "openai",
    })).toBeNull();
  });
});
