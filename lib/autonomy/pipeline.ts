import { runReviewAgents, type AgentReviewResult } from "@/lib/autonomy/agents";
import { evaluateApproval, type ApprovalResult } from "@/lib/autonomy/approval";
import type { AutomaticAction, EffectiveAutonomyControls } from "@/lib/autonomy/controls";
import { reclassifyAgainstDeclared, type DiffFile, type DiffRiskAssessment } from "@/lib/autonomy/diff-risk";
import { evaluateGates, type GateEvaluation, type GateResult } from "@/lib/autonomy/gates";
import type { EligibilityResult } from "@/lib/autonomy/merge-eligibility";
import { evaluateMergeReadiness, type MergeReadinessRequest } from "@/lib/autonomy/merge-readiness";
import {
  evaluatePostDeployValidation,
  type PostDeployValidationRequest,
} from "@/lib/autonomy/post-deploy";
import type { RiskLevel } from "@/lib/risk";

/**
 * The orchestrator: one pass of the autonomous loop, as a decision machine.
 *
 * Stages are ordered and a run advances one stage at a time. A run never skips
 * a stage, and a stage that cannot complete records *why* rather than failing
 * silently. Three stages have no executor in this tree and say so by name
 * instead of pretending to run.
 */

export const PIPELINE_STAGES = [
  "intake",
  "classify",
  "implement",
  "verify",
  "review",
  "pull_request",
  "risk_gate",
  "approval",
  "merge",
  "deploy",
  "validate",
  "report",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Readonly<Record<PipelineStage, string>> = Object.freeze({
  intake: "Intake",
  classify: "Classify",
  implement: "Implement",
  verify: "Verify",
  review: "Review",
  pull_request: "Pull request",
  risk_gate: "Risk gate",
  approval: "Approval",
  merge: "Merge",
  deploy: "Deploy",
  validate: "Validate",
  report: "Report",
});

/**
 * Stages that require an executor this tree does not have.
 *
 * `implement` needs the Phase 1C Codex worker; `merge` and `deploy` need
 * adapters that `AGENTS.md` and `policies/AUTO_ROLLBACK.md` forbid introducing
 * here. Each is reached, evaluated, and then blocked by name.
 */
export const UNEXECUTABLE_STAGES: Readonly<Record<string, string>> = Object.freeze({
  implement: "CODEX_WORKER_NOT_CONNECTED",
  merge: "MERGE_EXECUTOR_NOT_CONNECTED",
  deploy: "DEPLOY_EXECUTOR_NOT_CONNECTED",
});

/**
 * The deployment a run refers to when it reached `validate` without one.
 *
 * It exists so the absent case goes through the same evaluation as the present
 * case rather than around it. Every field is empty and `ready` is false, so it
 * can only ever produce `inconclusive`.
 */
const UNVALIDATED_DEPLOYMENT = Object.freeze({
  projectId: "",
  environment: "production" as const,
  provider: "",
  deploymentId: "",
  commitSha: "",
  url: "",
  ready: false,
});

export type StageStatus = "pending" | "satisfied" | "blocked";

export interface StageOutcome {
  readonly stage: PipelineStage;
  readonly status: StageStatus;
  /** Machine-readable reason a stage is blocked. Absent when satisfied. */
  readonly blocker?: string;
  readonly detail: string;
}

export interface PipelineInput {
  readonly action: AutomaticAction;
  readonly declaredRisk: RiskLevel;
  readonly files: readonly DiffFile[];
  readonly gateResults: readonly GateResult[];
  readonly controls: EffectiveAutonomyControls;
  readonly authorId: string;
  readonly approverId?: string | null;
  readonly ownerApproval?: "NOT_REQUESTED" | "PENDING" | "APPROVED" | "REJECTED";
  /** Whether an isolated branch, commit, and draft PR exist for this run. */
  readonly pullRequestOpen?: boolean;
  readonly hasTestChanges?: boolean;
  /**
   * Who wrote the change under review.
   *
   * A human-authored diff satisfies `implement` — the code exists, and the loop
   * is being asked to *decide* about it, which is the whole job of this phase.
   * Only a run that expects the loop to produce the code itself needs the Phase
   * 1C worker, and only that run blocks here.
   */
  readonly codeAuthoredBy?: "human" | "worker";
  /**
   * The last-moment revalidation inputs, read at merge time rather than when
   * the change was gated. Omitted when the run is not attempting a merge.
   */
  readonly mergeReadiness?: Omit<MergeReadinessRequest, "approved" | "executorConnected">;
  /**
   * Whether a merge executor is available at all. Defaults to false, so a
   * caller that does not know stays blocked rather than being assumed capable.
   */
  readonly mergeExecutorConnected?: boolean;
  /**
   * The `AUTO_MERGE_POLICY.md` allowlist, size and scope decision. Absent means
   * no merge target was authorized, which blocks — the same reading
   * `merge-eligibility.ts` takes of a missing allowlist.
   */
  readonly mergeEligibility?: EligibilityResult;
  /**
   * The result of establishing whether production actually received this
   * change. Structural rather than imported, so this module stays free of the
   * server-only deployment adapter and remains testable as pure logic.
   *
   * Absent means nothing was established, which blocks. Merging is not
   * shipping, and assuming otherwise is how a failed build reads as a release.
   */
  readonly deployment?: {
    readonly outcome: "deployed" | "failed" | "pending" | "not_found" | "not_connected";
    readonly deploymentId: string | null;
    readonly reason: string;
  };
  /**
   * Post-deploy validation evidence, read after a deploy rather than when the
   * change was gated. Omitting it does not mean "fine" — the stage treats an
   * absent record as `inconclusive`, which is what the policy requires.
   */
  readonly postDeployValidation?: PostDeployValidationRequest;
}

export interface PipelineRun {
  readonly stages: readonly StageOutcome[];
  /** The furthest stage reached. Equals the blocked stage when one blocked. */
  readonly reachedStage: PipelineStage;
  readonly completed: boolean;
  readonly assessment: DiffRiskAssessment;
  readonly riskEscalated: boolean;
  readonly gates: GateEvaluation;
  readonly agents: AgentReviewResult;
  readonly approval: ApprovalResult;
}

function satisfied(stage: PipelineStage, detail: string): StageOutcome {
  return Object.freeze({ stage, status: "satisfied", detail });
}

function blocked(stage: PipelineStage, blocker: string, detail: string): StageOutcome {
  return Object.freeze({ stage, status: "blocked", blocker, detail });
}

/**
 * Run one pass and return every stage outcome.
 *
 * The run stops at the first blocked stage — that is what "blocking findings
 * stop progression" means — but the stages already evaluated are returned in
 * full, so an operator sees how far it got and exactly what stopped it.
 *
 * Classification happens against the real diff rather than the declared risk,
 * and an escalation is carried into the approval decision. Work that opened
 * GREEN and ended up touching a migration is judged as what it became.
 */
export function runPipeline(input: PipelineInput): PipelineRun {
  const { assessment, escalated } = reclassifyAgainstDeclared(input.declaredRisk, input.files);
  const risk = assessment.level;
  const gates = evaluateGates(risk, input.gateResults);
  const agents = runReviewAgents({
    files: input.files,
    assessment,
    gateResults: input.gateResults,
    hasTestChanges: input.hasTestChanges,
  });
  const approval = evaluateApproval({
    action: input.action,
    risk,
    controls: input.controls,
    gates,
    agents,
    authorId: input.authorId,
    approverId: input.approverId,
    ownerApproval: input.ownerApproval,
    riskEscalated: escalated,
  });

  const stages: StageOutcome[] = [];
  let reachedStage: PipelineStage = "intake";
  let halted = false;

  for (const stage of PIPELINE_STAGES) {
    if (halted) break;
    reachedStage = stage;

    const outcome = evaluateStage(stage, { input, assessment, escalated, gates, agents, approval });
    stages.push(outcome);
    if (outcome.status === "blocked") halted = true;
  }

  return Object.freeze({
    stages: Object.freeze(stages),
    reachedStage,
    completed: !halted,
    assessment,
    riskEscalated: escalated,
    gates,
    agents,
    approval,
  });
}

interface StageContext {
  readonly input: PipelineInput;
  readonly assessment: DiffRiskAssessment;
  readonly escalated: boolean;
  readonly gates: GateEvaluation;
  readonly agents: AgentReviewResult;
  readonly approval: ApprovalResult;
}

function evaluateStage(stage: PipelineStage, context: StageContext): StageOutcome {
  const { input, assessment, escalated, gates, agents, approval } = context;

  switch (stage) {
    case "intake":
      return input.files.length === 0
        ? blocked(stage, "NO_WORK", "There is nothing to do.")
        : satisfied(stage, `${input.files.length} changed file(s) accepted.`);

    case "classify":
      return escalated
        ? blocked(
            stage,
            "RISK_ESCALATED",
            `Declared ${input.declaredRisk}, but the diff classifies ${assessment.level}.`,
          )
        : satisfied(stage, `Classified ${assessment.level}.`);

    case "implement":
      return (input.codeAuthoredBy ?? "human") === "human"
        ? satisfied(stage, "The change was written by a human author; the loop only decides it.")
        : blocked(
            stage,
            UNEXECUTABLE_STAGES.implement,
            "No autonomous execution worker is bound; manual Phase 1C cannot produce this loop change.",
          );

    case "verify":
      return gates.satisfied
        ? satisfied(stage, `${gates.passed.length} required gate(s) passed.`)
        : blocked(stage, "GATES_NOT_SATISFIED", `${gates.blockers.length} gate(s) blocking.`);

    case "review":
      return agents.clear
        ? satisfied(stage, `${agents.findings.length} finding(s), none blocking.`)
        : blocked(
            stage,
            "BLOCKING_FINDINGS",
            `${agents.blockingFindings.length} blocking finding(s).`,
          );

    case "pull_request":
      return input.pullRequestOpen
        ? satisfied(stage, "A draft pull request exists for this run.")
        : blocked(stage, "NO_PULL_REQUEST", "No draft pull request exists for this run.");

    case "risk_gate":
      return satisfied(stage, `Risk gate evaluated at ${assessment.level}.`);

    case "approval":
      return approval.decision === "APPROVED_AUTOMATICALLY"
        ? satisfied(stage, "Approved automatically.")
        : blocked(stage, approval.decision, approval.reason);

    case "merge": {
      // Revalidate against the current head before anything is attempted: an
      // approval and a test run both describe the commit they were made
      // against, not whatever is on the branch now.
      if (!input.mergeReadiness) {
        // Two different absences. With no executor, that is the dominant fact
        // and the older, blunter answer is the correct one. With an executor
        // available, missing revalidation inputs mean nothing was re-asked at
        // the last moment, which is exactly the staleness this stage exists to
        // prevent — so it gets its own name rather than borrowing one.
        return input.mergeExecutorConnected
          ? blocked(
            stage,
            "MERGE_READINESS_NOT_EVALUATED",
            "Merge readiness was not evaluated against the current head.",
          )
          : blocked(
            stage,
            UNEXECUTABLE_STAGES.merge,
            "No merge executor is connected.",
          );
      }

      const readiness = evaluateMergeReadiness({
        ...input.mergeReadiness,
        approved: approval.decision === "APPROVED_AUTOMATICALLY",
        executorConnected: input.mergeExecutorConnected ?? false,
      });
      // Report a stale approval or a conflict ahead of the executor's absence:
      // those matter regardless of whether an executor exists.
      const first = readiness.blockers.find(
        (blocker) => blocker !== "MERGE_EXECUTOR_NOT_CONNECTED",
      );
      if (first) return blocked(stage, first, readiness.reason);

      // Only the executor's own absence can remain. It outranks the allowlist
      // because "nothing can merge" is a more fundamental answer than "this
      // target was not authorized".
      if (!readiness.ready) {
        return blocked(stage, UNEXECUTABLE_STAGES.merge, readiness.reason);
      }

      // The policy's other half. An absent decision is not permission — it
      // means no merge target was ever authorized.
      if (!input.mergeEligibility) {
        return blocked(
          stage,
          "ALLOWLIST_NOT_CONFIGURED",
          "No auto-merge allowlist decision was supplied, so no merge target is authorized.",
        );
      }
      if (!input.mergeEligibility.eligible) {
        return blocked(
          stage,
          input.mergeEligibility.blockers[0] ?? "ALLOWLIST_NOT_CONFIGURED",
          input.mergeEligibility.reason,
        );
      }

      return satisfied(
        stage,
        `Every merge precondition holds against ${readiness.evaluatedHeadSha.slice(0, 7)}.`,
      );
    }

    case "deploy": {
      if (!input.deployment) {
        return blocked(
          stage,
          UNEXECUTABLE_STAGES.deploy,
          "No deployment adapter is connected.",
        );
      }

      switch (input.deployment.outcome) {
        case "deployed":
          return satisfied(
            stage,
            `Production deployment ${input.deployment.deploymentId ?? "(unnamed)"} is ready.`,
          );
        case "failed":
          return blocked(stage, "DEPLOYMENT_FAILED", input.deployment.reason);
        case "pending":
          // Not a failure. Nobody watched long enough to say, and calling that
          // a failure would raise an incident for a build that may be fine.
          return blocked(stage, "DEPLOYMENT_PENDING", input.deployment.reason);
        case "not_found":
          return blocked(stage, "DEPLOYMENT_NOT_FOUND", input.deployment.reason);
        default:
          return blocked(stage, UNEXECUTABLE_STAGES.deploy, input.deployment.reason);
      }
    }

    case "validate": {
      // `POST_DEPLOY_VALIDATION.md`: missing, stale, or mismatched evidence is
      // `inconclusive`, never `passed`. A stage that reports satisfied because
      // nothing validated the deploy would invert that, so the absent case is
      // evaluated through the same function as the present one.
      const validation = evaluatePostDeployValidation(
        input.postDeployValidation ?? { deployment: UNVALIDATED_DEPLOYMENT, evidence: null },
      );

      return validation.outcome === "passed"
        ? satisfied(stage, "Post-deploy validation passed against matching, fresh evidence.")
        : blocked(
            stage,
            `VALIDATION_${validation.outcome.toUpperCase()}`,
            validation.reasons.join(" "),
          );
    }

    case "report":
      return satisfied(stage, "Run recorded.");
  }
}

/** A one-line summary per stage, for an activity record or a report. */
export function describeRun(run: PipelineRun): readonly string[] {
  return Object.freeze(
    run.stages.map(
      (outcome) =>
        `${STAGE_LABELS[outcome.stage]}: ${outcome.status}${
          outcome.blocker ? ` (${outcome.blocker})` : ""
        } — ${outcome.detail}`,
    ),
  );
}
