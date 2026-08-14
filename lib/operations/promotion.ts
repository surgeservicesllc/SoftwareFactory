import { assessCommandRisk } from "@/lib/orchestration/command";
import { createPhase1CExecutionPlan } from "@/lib/orchestration/plan";
import type { RiskLevel } from "@/lib/risk";

/**
 * Turn a Phase 1E diagnosis into a Phase 1C command.
 *
 * Phase 1E repair work previously wrote a bare `backlog` task with no command,
 * which Phase 1C could never claim — see
 * `AI/PHASE_1E_TO_1C_INTEGRATION_GAP.md`. This assembles the command that
 * closes that gap.
 *
 * Two rules shape it.
 *
 * The parameter object must satisfy Phase 1C's exact-key contract, so it is
 * built from `createPhase1CExecutionPlan` rather than hand-written. Duplicating
 * that contract is how it drifts; the builder is the single source of truth for
 * agent role, budget, model, plan, and provider.
 *
 * And repair work gets no privileged lane. The command carries an ordinary
 * risk assessment and is submitted through `submit_command` like any other, so
 * the database risk floor applies — a security-shaped repair is forced to RED
 * and therefore to owner approval, exactly as if a person had typed it.
 */

export interface RepositoryBinding {
  readonly appId: number;
  readonly baseBranch: string;
  readonly baseSha: string;
  readonly connectionId: string;
  readonly externalInstallationId: number;
  readonly externalRepositoryId: number;
  readonly installationId: string;
  readonly repositoryId: string;
}

export interface RepairDiagnosis {
  readonly likelyCause: string;
  readonly affectedSubsystem: string;
  readonly recommendedAction: string;
  /** Lowercase risk as stored by `production_diagnoses.risk_level`. */
  readonly riskLevel: "green" | "yellow" | "red";
}

export interface RepairCommand {
  readonly prompt: string;
  readonly requestedRisk: string;
  readonly effectiveRisk: string;
  readonly parameters: Record<string, unknown>;
  readonly idempotencyKey: string;
}

/** Phase 1C accepts at most 12 criteria, each 3-500 characters and distinct. */
const MAX_ACCEPTANCE_CRITERIA = 12;

function boundedCriterion(value: string): string {
  return value.trim().slice(0, 500);
}

export function buildRepairPrompt(diagnosis: RepairDiagnosis): string {
  return [
    `Repair the ${diagnosis.affectedSubsystem} subsystem in production.`,
    `Likely cause: ${diagnosis.likelyCause}`,
    `Recommended action: ${diagnosis.recommendedAction}`,
  ].join(" ");
}

export function buildRepairAcceptanceCriteria(diagnosis: RepairDiagnosis): string[] {
  const criteria = [
    boundedCriterion(`The ${diagnosis.affectedSubsystem} failure is fixed and verified.`),
    boundedCriterion("Existing behavior is preserved with no unrelated regressions."),
    boundedCriterion("A regression test covers the failure so it cannot return unnoticed."),
  ];
  // The contract requires distinct entries, so identical wording is collapsed
  // rather than submitted and rejected.
  return [...new Set(criteria)].slice(0, MAX_ACCEPTANCE_CRITERIA);
}

/**
 * Assemble the command. `binding.baseSha` must come from a live repository read
 * by the caller — a stale or invented SHA would send a worker at the wrong tree.
 */
export function buildRepairCommand(input: {
  readonly diagnosis: RepairDiagnosis;
  readonly binding: RepositoryBinding;
  readonly repairAttemptId: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): RepairCommand {
  const prompt = buildRepairPrompt(input.diagnosis);
  const acceptanceCriteria = buildRepairAcceptanceCriteria(input.diagnosis);
  const requestedRisk = input.diagnosis.riskLevel.toUpperCase() as RiskLevel;

  const riskAssessment = assessCommandRisk({
    acceptanceCriteria,
    commandType: "fix_bug",
    prompt,
    requestedRisk,
  });

  const executionPlan = createPhase1CExecutionPlan("fix_bug", input.environment ?? process.env);

  return Object.freeze({
    prompt,
    requestedRisk: riskAssessment.requestedRisk.toLowerCase(),
    effectiveRisk: riskAssessment.effectiveRisk.toLowerCase(),
    // Exactly the keys Phase 1C's allowlist compares against, no more and no
    // fewer. The incident linkage deliberately lives on `repair_attempts`
    // rather than here, because an extra key fails the whole contract.
    parameters: Object.freeze({
      acceptanceCriteria,
      agentRole: executionPlan.agentRole,
      budget: executionPlan.budget,
      commandType: "fix_bug",
      dependencyTaskIds: [],
      executionMode: "manual",
      model: executionPlan.model,
      plan: executionPlan.plan,
      provider: executionPlan.provider,
      repositoryBinding: {
        appId: input.binding.appId,
        baseBranch: input.binding.baseBranch,
        baseSha: input.binding.baseSha,
        connectionId: input.binding.connectionId,
        externalInstallationId: input.binding.externalInstallationId,
        externalRepositoryId: input.binding.externalRepositoryId,
        installationId: input.binding.installationId,
        repositoryId: input.binding.repositoryId,
      },
      riskAssessment: {
        factors: riskAssessment.factors,
        reasons: riskAssessment.reasons,
        requestedRisk: riskAssessment.requestedRisk.toLowerCase(),
      },
    }),
    // One repair attempt yields one command however often promotion is retried.
    idempotencyKey: `repair:${input.repairAttemptId}`,
  });
}

/** The exact key set Phase 1C compares against, for assertion in tests. */
export const PHASE_1C_PARAMETER_KEYS = Object.freeze([
  "acceptanceCriteria",
  "agentRole",
  "budget",
  "commandType",
  "dependencyTaskIds",
  "executionMode",
  "model",
  "plan",
  "provider",
  "repositoryBinding",
  "riskAssessment",
]);
