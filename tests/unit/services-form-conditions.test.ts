import { describe, expect, it } from "vitest";

import {
  askedNow,
  conditionMet,
  type ConditionedQuestion,
  describeCondition,
  opsForFieldType,
  readServiceTypeList,
  readShowWhen,
  toFormQuestionView,
} from "@/lib/services/form-conditions";

describe("a condition's shape", () => {
  it("accepts exactly the five ops with exactly their operands", () => {
    expect(readShowWhen({ op: "answered" })).toEqual({ op: "answered" });
    expect(readShowWhen({ op: "is_true" })).toEqual({ op: "is_true" });
    expect(readShowWhen({ op: "equals", value: "high" })).toEqual({ op: "equals", value: "high" });
    expect(readShowWhen({ op: "any_of", values: ["rodents", "mice"] })).toEqual({ op: "any_of", values: ["rodents", "mice"] });
    expect(readShowWhen({ op: "equals" })).toBeNull();
    expect(readShowWhen({ op: "any_of", values: [] })).toBeNull();
    expect(readShowWhen({ op: "answered", value: "x" })).toBeNull();
    expect(readShowWhen({ op: "sometimes" })).toBeNull();
    expect(readShowWhen("answered")).toBeNull();
    expect(readShowWhen(null)).toBeNull();
  });

  it("offers a yes/no parent its own ops and every other parent the value ops", () => {
    expect(opsForFieldType("boolean")).toEqual(["answered", "is_true", "is_false"]);
    expect(opsForFieldType("select")).toEqual(["answered", "equals", "any_of"]);
  });

  it("says the rule in words beside the question", () => {
    expect(describeCondition({ op: "is_true" }, "Pests found?")).toBe("asked when “Pests found?” is yes");
    expect(describeCondition({ op: "is_false" }, "Pests found?")).toBe("asked when “Pests found?” is no");
    expect(describeCondition({ op: "answered" }, "Notes")).toBe("asked when “Notes” is answered");
    expect(describeCondition({ op: "equals", value: "high" }, "Severity")).toBe("asked when “Severity” is “high”");
    expect(describeCondition({ op: "any_of", values: ["rodents", "mice"] }, "Which pests?")).toBe("asked when “Which pests?” is “rodents” or “mice”");
  });
});

describe("the rule, mirrored", () => {
  it("evaluates each op over each answer shape the way the database does", () => {
    expect(conditionMet({ op: "answered" }, null)).toBe(false);
    expect(conditionMet({ op: "answered" }, { kind: "text", value: "x" })).toBe(true);
    expect(conditionMet({ op: "is_true" }, { kind: "boolean", value: true })).toBe(true);
    expect(conditionMet({ op: "is_true" }, { kind: "boolean", value: false })).toBe(false);
    expect(conditionMet({ op: "is_false" }, { kind: "boolean", value: false })).toBe(true);
    expect(conditionMet({ op: "is_false" }, null)).toBe(false);
    expect(conditionMet({ op: "equals", value: "12" }, { kind: "number", value: 12 })).toBe(true);
    expect(conditionMet({ op: "equals", value: "rodents" }, { kind: "options", value: ["ants", "rodents"] })).toBe(true);
    expect(conditionMet({ op: "any_of", values: ["rodents"] }, { kind: "options", value: ["ants"] })).toBe(false);
    expect(conditionMet({ op: "any_of", values: ["high", "moderate"] }, { kind: "text", value: "high" })).toBe(true);
  });

  it("walks the whole chain: an unasked parent makes the child unasked whatever its stale answer", () => {
    const pests = { fieldId: "p", dependsOnFieldId: null, showWhen: null };
    const which = { fieldId: "w", dependsOnFieldId: "p", showWhen: { op: "is_true" as const } };
    const bait = { fieldId: "b", dependsOnFieldId: "w", showWhen: { op: "any_of" as const, values: ["rodents"] } };
    const byId = new Map<string, ConditionedQuestion>([["p", pests], ["w", which], ["b", bait]]);
    expect(askedNow(bait, byId, new Map([["p", { kind: "boolean", value: true }], ["w", { kind: "options", value: ["rodents"] }]]))).toBe(true);
    expect(askedNow(bait, byId, new Map([["p", { kind: "boolean", value: false }], ["w", { kind: "options", value: ["rodents"] }]]))).toBe(false);
    expect(askedNow(which, byId, new Map())).toBe(false);
    expect(askedNow(pests, byId, new Map())).toBe(true);
  });

  it("maps a question row with its condition in words", () => {
    const view = toFormQuestionView({
      field_id: "w", field_position: 2, label: "Which pests?", field_type: "multi_select", required: true, help_text: null,
      options: ["ants"], depends_on_field_id: "p", depends_on_label: "Pests found?", show_when: { op: "is_true" }, asked: false, answered: false,
    });
    expect(view).toMatchObject({ position: 2, condition: "asked when “Pests found?” is yes", asked: false, showWhen: { op: "is_true" } });
  });
});

describe("the trigger list", () => {
  it("trims, de-duplicates case-insensitively, drops the empty and the too long, and stops at fifty", () => {
    expect(readServiceTypeList(" Rodent control, rodent CONTROL ,, General pest ")).toEqual(["Rodent control", "General pest"]);
    expect(readServiceTypeList("x".repeat(121))).toEqual([]);
    expect(readServiceTypeList(Array.from({ length: 60 }, (_, index) => `t${index}`).join(","))).toHaveLength(50);
  });
});
