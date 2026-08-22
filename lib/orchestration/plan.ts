import type { CommandType } from "@/lib/orchestration/command";

export const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";

export const FACTORY_RECORD_ONLY_PLAN = Object.freeze({
  requiresDraftPullRequest: false,
  stages: Object.freeze(["record"]),
  workflow: "factory_record_only",
});

export function classifyFactoryCommandExecutionIdentity(input: {
  readonly model: string;
  readonly provider: string;
}): "manual" | "record_only" | null {
  if (input.provider === "openai" && input.model === DEFAULT_CODEX_MODEL) return "manual";
  if (input.provider === "anthropic") return "record_only";
  return null;
}

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

/**
 * A Factory posting owns the provider/model identity selected for the command.
 * Only the existing Codex identity is claimable by the Phase 1C worker. A
 * reviewed Anthropic posting is durable routing intent only: it creates no
 * execution run and cannot be claimed by a worker. Every other identity is
 * refused until it receives its own reviewed recording contract.
 */
export function createFactoryCommandExecutionIntent(input: {
  readonly model: string;
  readonly phase1CPlan: ReturnType<typeof createPhase1CExecutionPlan>;
  readonly provider: string;
}) {
  const executionMode = classifyFactoryCommandExecutionIdentity(input);
  if (!executionMode) return null;

  return Object.freeze({
    executionMode,
    model: input.model,
    plan: executionMode === "manual" ? input.phase1CPlan.plan : FACTORY_RECORD_ONLY_PLAN,
    provider: input.provider,
  });
}
