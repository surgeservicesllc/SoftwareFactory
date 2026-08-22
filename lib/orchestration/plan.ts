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
  const provider = input.provider.trim();
  const model = input.model.trim();
  if (provider.length < 1 || provider.length > 40 || model.length < 1 || model.length > 128) {
    return null;
  }
  return "record_only";
}

/**
 * The one provider a Phase 1C command can actually execute on.
 *
 * Only the Codex worker claims from this queue — the Claude workflow verifies
 * its subscription and nothing else — so a command routed anywhere else would
 * be recorded for a worker that will never arrive.
 */
export const EXECUTION_PROVIDER = "openai" as const;

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

/**
 * The model the executor will accept, and therefore the model a bot has to
 * carry to be routable at all.
 *
 * Exported because provisioning has to ask this rather than guess: a bot
 * named from the catalog's list while the plan fixed a different string is
 * how every Codex bot in every workspace became unroutable, refused at the
 * last step of the journey with `PROVIDER_MODEL_MISMATCH`.
 */
export function executionModel(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
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
    model: executionModel(environment),
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
    provider: EXECUTION_PROVIDER,
  });
}

/**
 * A Factory posting owns the provider/model identity selected for the command.
 * Only the existing Codex identity is claimable by the Phase 1C worker. Every
 * other bounded posting is durable routing intent only: it creates no
 * execution run and cannot be claimed by a worker.
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
