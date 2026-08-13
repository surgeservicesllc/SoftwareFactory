import { z } from "zod";

import {
  RISK_DEFINITIONS,
  compareRisk,
  type RiskFactor,
  type RiskLevel,
} from "@/lib/risk";

export const commandTypeSchema = z.enum([
  "fix_bug",
  "build_feature",
  "audit",
  "test",
  "mobile",
  "security",
  "performance",
  "other",
]);

export type CommandType = z.infer<typeof commandTypeSchema>;

export const acceptanceCriterionSchema = z.string().trim().min(3).max(500);

const riskFloorByCommandType = Object.freeze({
  audit: "GREEN",
  build_feature: "YELLOW",
  fix_bug: "YELLOW",
  mobile: "YELLOW",
  other: "YELLOW",
  performance: "YELLOW",
  security: "RED",
  test: "GREEN",
} satisfies Record<CommandType, RiskLevel>);

const redPromptSignals = [
  /\b(auth(?:entication|orization)?|oauth|session|cookie|rbac|permission)\b/i,
  /\b(secret|credential|password|private[ _-]?key|api[ _-]?key|token)\b/i,
  /\b(rls|row[ -]?level security|service[ _-]?role)\b/i,
  /\b(production database|delete production|drop table|truncate)\b/i,
  /\b(dns|domain ownership|billing|payment|money)\b/i,
  /\b(auto[ -]?(merge|deploy|rollback|approve)|branch protection)\b/i,
] as const;

const yellowPromptSignals = [
  /\b(schema|migration|database)\b/i,
  /\b(dependency|package(?:\.json)?|lockfile|upgrade)\b/i,
  /\b(api|backend|frontend|component|route|workflow|configuration)\b/i,
  /\b(refactor|feature|bug|performance|mobile|accessibility)\b/i,
] as const;

function highestRisk(left: RiskLevel, right: RiskLevel) {
  return compareRisk(left, right) >= 0 ? left : right;
}

export type CommandRiskAssessment = Readonly<{
  effectiveRisk: RiskLevel;
  factors: readonly RiskFactor[];
  reasons: readonly string[];
  requestedRisk: RiskLevel;
}>;

/**
 * Deterministically classifies a command before persistence. Model output is
 * never trusted to lower the caller request or the policy floor.
 */
export function assessCommandRisk(input: {
  commandType: CommandType;
  prompt: string;
  acceptanceCriteria?: readonly string[];
  requestedRisk: RiskLevel;
}): CommandRiskAssessment {
  const factors: RiskFactor[] = [];
  const reasons: string[] = [];
  let effectiveRisk = highestRisk(
    input.requestedRisk,
    riskFloorByCommandType[input.commandType],
  );

  if (input.commandType === "audit") factors.push("documentation-only");
  if (input.commandType === "test") factors.push("test-only");
  if (["build_feature", "fix_bug", "mobile", "performance"].includes(input.commandType)) {
    factors.push("application-behavior");
  }
  if (input.commandType === "security") {
    factors.push("authentication-or-security-controls");
    reasons.push("Security work is owner-approved RED in Phase 1.");
  }

  const instructionText = [input.prompt, ...(input.acceptanceCriteria ?? [])].join("\n");
  if (redPromptSignals.some((signal) => signal.test(instructionText))) {
    effectiveRisk = "RED";
    if (!factors.includes("authentication-or-security-controls")) {
      factors.push("authentication-or-security-controls");
    }
    reasons.push("The request mentions a protected production or security boundary.");
  } else if (yellowPromptSignals.some((signal) => signal.test(instructionText))) {
    effectiveRisk = highestRisk(effectiveRisk, "YELLOW");
    if (!factors.includes("application-behavior")) factors.push("application-behavior");
    reasons.push("The request changes application behavior or engineering infrastructure.");
  }

  if (compareRisk(input.requestedRisk, riskFloorByCommandType[input.commandType]) > 0) {
    reasons.push(`The owner requested the stricter ${input.requestedRisk} tier.`);
  }
  if (reasons.length === 0) {
    reasons.push(RISK_DEFINITIONS[effectiveRisk].description);
  }

  return Object.freeze({
    effectiveRisk,
    factors: Object.freeze([...new Set(factors)]),
    reasons: Object.freeze(reasons),
    requestedRisk: input.requestedRisk,
  });
}

export function normalizeAcceptanceCriteria(criteria: readonly string[]) {
  const normalized = criteria
    .map((criterion) => criterion.trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}
