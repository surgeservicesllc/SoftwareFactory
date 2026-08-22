import { describe, expect, it } from "vitest";

import { findBotProvider } from "@/lib/bots/catalog";
import {
  createPhase1CExecutionPlan,
  EXECUTION_PROVIDER,
  executionModel,
} from "@/lib/orchestration/plan";

/**
 * The bot a workspace is given must be a bot the executor will accept.
 *
 * `selectFactoryCommandRoute` refuses any candidate whose provider and model
 * are not exactly the plan's, and `submit_factory_command` repeats that check
 * in the database. So the model a bot is provisioned with and the model the
 * plan fixes are not two independent choices — they are one fact written in
 * two files, and when they drifted apart every Codex bot in every workspace
 * became unroutable with `PROVIDER_MODEL_MISMATCH`. The console had shipped a
 * bot the executor could never match, and the only symptom was a refusal at
 * the last step of the journey.
 *
 * These assertions are the tie. They are about agreement, not about any
 * particular model string, so rolling the executor to a new version stays a
 * one-line change rather than a hunt.
 */

describe("the executable model and the catalog agree", () => {
  it("offers the executing provider's executable model first, so a provisioned bot can run", () => {
    const provider = findBotProvider(EXECUTION_PROVIDER);
    expect(provider).not.toBeNull();
    // `ensureProviderBot` names a new bot's model from this list's head.
    expect(provider?.suggestedModels[0]).toBe(executionModel({}));
  });

  it("keeps every command type on the one model the worker claims", () => {
    const expected = executionModel({});
    for (const commandType of [
      "audit", "build_feature", "fix_bug", "mobile",
      "other", "performance", "security", "test",
    ] as const) {
      const plan = createPhase1CExecutionPlan(commandType, {});
      expect(plan.provider).toBe(EXECUTION_PROVIDER);
      expect(plan.model).toBe(expected);
    }
  });

  it("resolves the same model an operator pins for the worker", () => {
    // The worker workflow sets this variable, so an operator rolling the
    // executor forward moves the plan and any newly provisioned bot together.
    const pinned = { SOFTWAREFACTORY_CODEX_MODEL: "gpt-5.4-codex" };
    expect(executionModel(pinned)).toBe("gpt-5.4-codex");
    expect(createPhase1CExecutionPlan("audit", pinned).model).toBe("gpt-5.4-codex");
  });
});
