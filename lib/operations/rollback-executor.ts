/**
 * The rollback executor.
 *
 * Phase 1E could decide a rollback was warranted and then do nothing about it —
 * `evaluateRollbackEligibility` returned a verdict and every rollback recorded
 * `EXECUTOR_NOT_CONNECTED`. This is the missing half.
 *
 * Three rules shape it, and each exists because the opposite is a plausible
 * mistake under pressure:
 *
 * 1. **A rollback never reverses a database migration.** Code can be rolled
 *    back; applied schema and data changes generally cannot, and a "rollback"
 *    that reverted a migration could destroy data the new code already wrote.
 *    When the failed deployment carried a migration, this refuses and asks for
 *    an owner, keeping the freeze on.
 *
 * 2. **The freeze outlives a failed rollback.** If the recovery does not work,
 *    the protection that stopped further releases must stay, or a failing
 *    system quietly reopens for business.
 *
 * 3. **Restored means observed, not requested.** A provider reporting READY is
 *    the provider's opinion about its own deployment. Post-rollback validation
 *    runs against the real target, and the outcome is what decides whether the
 *    incident may progress.
 *
 * The provider call is injected, so the whole decision sequence is testable
 * without a deployment token. Nothing here is a model call — this is a state
 * machine, and paying a model to run it would make it slower and less
 * predictable for no gain.
 */

export const ROLLBACK_OUTCOMES = [
  "ROLLED_BACK",
  "ROLLBACK_FAILED",
  "OWNER_ACTION_REQUIRED",
  "NOT_ELIGIBLE",
] as const;
export type RollbackOutcome = (typeof ROLLBACK_OUTCOMES)[number];

export type DeploymentRef = {
  readonly deploymentId: string;
  readonly commitSha: string;
  /** Whether this deployment's own post-deploy validation passed. */
  readonly validationPassed: boolean;
  /** Whether it shipped a database migration. */
  readonly containsMigration: boolean;
};

/** The supported provider operations. Deliberately small. */
export type RollbackAdapter = {
  /**
   * Promote a previously validated deployment back to production.
   *
   * Promotion rather than redeploy: rebuilding could produce a different
   * artifact from the same commit, and the point of a rollback is to restore
   * the thing that was known to work.
   */
  readonly promote: (deploymentId: string) => Promise<{ ok: boolean; detail: string }>;
  /** Current provider-reported state of a deployment. */
  readonly state: (deploymentId: string) => Promise<"READY" | "BUILDING" | "ERROR" | "UNKNOWN">;
};

/** Observes the real target after the promotion, rather than trusting it. */
export type RecoveryValidator = () => Promise<{ healthy: boolean; detail: string }>;

export type RollbackExecutionInput = {
  readonly incidentId: string;
  readonly projectId: string;
  readonly failedDeployment: DeploymentRef;
  /** Candidates newest-first. The first validated one is the target. */
  readonly candidates: readonly DeploymentRef[];
  readonly attemptsAlready: number;
  readonly maxAttempts: number;
  /** Whether the release freeze is currently applied. */
  readonly freezeApplied: boolean;
};

export type RollbackExecution = {
  readonly outcome: RollbackOutcome;
  readonly targetDeploymentId: string | null;
  /** True whenever the freeze must remain after this returns. */
  readonly freezeMustRemain: boolean;
  /** Set when a human has to act, and says what they must decide. */
  readonly ownerAction: string | null;
  /** Set when the incident must be escalated to SEV1. */
  readonly escalateToSev1: boolean;
  readonly steps: readonly string[];
  readonly detail: string;
};

export type RollbackDependencies = {
  /** Absent when no deployment provider is configured. */
  readonly adapter?: RollbackAdapter | null;
  readonly validateRecovery?: RecoveryValidator;
  /** Bounded polling of the provider state. Injected so tests do not sleep. */
  readonly waitForSettle?: (deploymentId: string, adapter: RollbackAdapter) => Promise<"READY" | "ERROR" | "UNKNOWN">;
};

/** The last validated deployment that is not the one that just failed. */
export function resolveLastKnownGood(
  failed: DeploymentRef,
  candidates: readonly DeploymentRef[],
): DeploymentRef | null {
  return (
    candidates.find(
      (candidate) =>
        candidate.deploymentId !== failed.deploymentId && candidate.validationPassed,
    ) ?? null
  );
}

async function defaultWaitForSettle(
  deploymentId: string,
  adapter: RollbackAdapter,
): Promise<"READY" | "ERROR" | "UNKNOWN"> {
  // Bounded on purpose: an unbounded wait turns a failed rollback into a hang,
  // and a hang is the one outcome nobody gets paged for.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const state = await adapter.state(deploymentId);
    if (state === "READY") return "READY";
    if (state === "ERROR") return "ERROR";
  }
  return "UNKNOWN";
}

export async function executeRollback(
  input: RollbackExecutionInput,
  deps: RollbackDependencies = {},
): Promise<RollbackExecution> {
  const steps: string[] = [];

  if (input.attemptsAlready >= input.maxAttempts) {
    return {
      outcome: "OWNER_ACTION_REQUIRED",
      targetDeploymentId: null,
      freezeMustRemain: true,
      ownerAction:
        `Rollback has been attempted ${input.attemptsAlready} time(s), reaching the limit of ${input.maxAttempts}. ` +
        "Repeating it will not produce a different result; the cause needs a person.",
      escalateToSev1: true,
      steps,
      detail: "Rollback attempt ceiling reached.",
    };
  }

  // Rule 1, checked before anything else: a migration makes automatic rollback
  // unsafe regardless of how healthy the previous deployment looked.
  if (input.failedDeployment.containsMigration) {
    steps.push("Refused automatic rollback: the failed deployment shipped a database migration.");
    return {
      outcome: "OWNER_ACTION_REQUIRED",
      targetDeploymentId: null,
      freezeMustRemain: true,
      ownerAction:
        "The failed deployment shipped a database migration. Rolling the code back would leave it running against " +
        "a schema it does not expect, and reversing the migration could destroy data written since. Decide manually " +
        "whether to roll forward with a fix or to reverse the schema deliberately.",
      escalateToSev1: false,
      steps,
      detail: "Automatic rollback is unsafe across a migration boundary.",
    };
  }

  const target = resolveLastKnownGood(input.failedDeployment, input.candidates);
  if (!target) {
    steps.push("No previous deployment has its own passing validation.");
    return {
      outcome: "OWNER_ACTION_REQUIRED",
      targetDeploymentId: null,
      freezeMustRemain: true,
      ownerAction:
        "No Last Known Good deployment exists: no earlier deployment passed its own post-deploy validation. " +
        "A deployment that merely reported READY is not a rollback target.",
      escalateToSev1: false,
      steps,
      detail: "No validated rollback target.",
    };
  }
  steps.push(`Resolved Last Known Good ${target.deploymentId} (${target.commitSha}).`);

  if (!input.freezeApplied) {
    // Rolling back while releases are still flowing would race the rollback
    // against the next deploy.
    steps.push("Freeze was not applied; it must be in place before recovery.");
    return {
      outcome: "OWNER_ACTION_REQUIRED",
      targetDeploymentId: target.deploymentId,
      freezeMustRemain: true,
      ownerAction: "Apply the release freeze before rolling back, so the rollback does not race the next release.",
      escalateToSev1: false,
      steps,
      detail: "Rollback requires an active release freeze.",
    };
  }

  if (!deps.adapter) {
    steps.push("No deployment provider is connected.");
    return {
      outcome: "OWNER_ACTION_REQUIRED",
      targetDeploymentId: target.deploymentId,
      freezeMustRemain: true,
      ownerAction:
        `Connect a deployment provider token so the rollback to ${target.deploymentId} can be executed, ` +
        "or promote that deployment by hand. The freeze stays on until production is restored.",
      escalateToSev1: false,
      steps,
      detail: "Rollback executor is not connected to a deployment provider.",
    };
  }

  const promotion = await deps.adapter.promote(target.deploymentId);
  steps.push(`Promotion requested: ${promotion.detail}`);
  if (!promotion.ok) {
    return {
      outcome: "ROLLBACK_FAILED",
      targetDeploymentId: target.deploymentId,
      freezeMustRemain: true,
      ownerAction: "The rollback could not be executed. Production is still on the failed deployment.",
      // A failed rollback is strictly worse than the failure that prompted it.
      escalateToSev1: true,
      steps,
      detail: promotion.detail,
    };
  }

  const settle = deps.waitForSettle ?? defaultWaitForSettle;
  const settled = await settle(target.deploymentId, deps.adapter);
  steps.push(`Provider settled at ${settled}.`);
  if (settled !== "READY") {
    return {
      outcome: "ROLLBACK_FAILED",
      targetDeploymentId: target.deploymentId,
      freezeMustRemain: true,
      ownerAction: "The promoted deployment did not reach a ready state.",
      escalateToSev1: true,
      steps,
      detail: `Promoted deployment settled at ${settled} rather than READY.`,
    };
  }

  // Rule 3: the provider saying READY is its opinion about its own deployment.
  if (!deps.validateRecovery) {
    return {
      outcome: "OWNER_ACTION_REQUIRED",
      targetDeploymentId: target.deploymentId,
      freezeMustRemain: true,
      ownerAction:
        "The rollback was promoted but no recovery validator is configured, so restoration is unverified. " +
        "The freeze stays on until something observes production directly.",
      escalateToSev1: false,
      steps,
      detail: "Recovery could not be validated.",
    };
  }

  const recovery = await deps.validateRecovery();
  steps.push(`Recovery validation: ${recovery.detail}`);
  if (!recovery.healthy) {
    return {
      outcome: "ROLLBACK_FAILED",
      targetDeploymentId: target.deploymentId,
      freezeMustRemain: true,
      ownerAction: "Production is still unhealthy after rolling back, so the cause is not the last deployment.",
      escalateToSev1: true,
      steps,
      detail: recovery.detail,
    };
  }

  return {
    outcome: "ROLLED_BACK",
    targetDeploymentId: target.deploymentId,
    // The freeze lifts by an owner-visible decision, not as a side effect of a
    // rollback: the code is restored, the underlying defect is not fixed.
    freezeMustRemain: true,
    ownerAction: null,
    escalateToSev1: false,
    steps,
    detail: `Production restored to ${target.deploymentId} and observed healthy.`,
  };
}
