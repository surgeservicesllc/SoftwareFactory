import type { CommandType } from "@/lib/orchestration/command";

export const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";

export type Phase1CAgentRole =
  | "orchestrator"
  | "architect"
  | "backend"
  | "custom"
  | "frontend"
  | "performance"
  | "qa"
  | "security";

const agentRoleByCommandType = Object.freeze({
  audit: "qa",
  build_feature: "architect",
  fix_bug: "backend",
  mobile: "frontend",
  other: "orchestrator",
  performance: "performance",
  security: "security",
  test: "qa",
} satisfies Record<CommandType, Phase1CAgentRole>);

export const DEFAULT_PHASE_1C_BUDGET = Object.freeze({
  ciTimeoutMs: 15 * 60_000,
  maximumDurationMs: 45 * 60_000,
  maximumInputTokens: 200_000,
  maximumOutputTokens: 50_000,
  maximumRepairAttempts: 1,
  maximumTurns: 4,
});

function configuredModel(environment: Readonly<Record<string, string | undefined>>) {
  const value = environment.SOFTWAREFACTORY_CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)) {
    throw new Error("SOFTWAREFACTORY_CODEX_MODEL is invalid.");
  }
  return value;
}

export function createPhase1CExecutionPlan(
  commandType: CommandType,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return Object.freeze({
    agentRole: agentRoleByCommandType[commandType],
    budget: DEFAULT_PHASE_1C_BUDGET,
    model: configuredModel(environment),
    plan: Object.freeze({
      requiresDraftPullRequest: true,
      stages: Object.freeze([
        "inspect",
        "implement",
        "validate",
        "policy_scan",
        "commit",
        "draft_pull_request",
        "ci",
        "report",
      ]),
      workflow: "codex_draft_pr",
    }),
    provider: "openai" as const,
  });
}
