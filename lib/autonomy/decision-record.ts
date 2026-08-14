import type { AutomaticAction } from "@/lib/autonomy/controls";
import type { PipelineRun } from "@/lib/autonomy/pipeline";
import type { RiskLevel } from "@/lib/risk";

/**
 * Turn a pipeline run into the row that gets written to the audit trail.
 *
 * The decision modules return rich objects — findings, gate results, stage
 * outcomes. Almost none of that belongs in an immutable record: it is large,
 * it changes shape as the modules evolve, and some of it (a diff, a provider
 * message) is exactly what must not be stored. What belongs is the decision,
 * the named blockers, and enough identity to tie it to a commit and a person.
 *
 * So this is a deliberate narrowing, not a serialization.
 */

export const AUTONOMY_POLICY_VERSION = "phase1d-decision-v1";

export interface AutonomyDecisionRecord {
  readonly projectId: string;
  readonly action: AutomaticAction;
  readonly decision: "APPROVED_AUTOMATICALLY" | "OWNER_APPROVAL_REQUIRED" | "NOT_APPROVED";
  readonly risk: RiskLevel;
  readonly riskEscalated: boolean;
  readonly headSha: string | null;
  readonly authorId: string | null;
  readonly approverId: string | null;
  /** Named codes only. Never a message, a diff, or intermediate reasoning. */
  readonly blockers: readonly string[];
  readonly reachedStage: string;
  readonly policyVersion: typeof AUTONOMY_POLICY_VERSION;
}

/**
 * Collect the blockers that explain the *decision*.
 *
 * A run can be approved and still halt — an approved change stops at merge
 * because no executor exists, which says nothing about whether approving it
 * was right. Those are two different facts, and folding the halt into the
 * decision's blockers would record a refusal that never happened.
 *
 * So an approval records no blockers, and `reachedStage` carries where the run
 * stopped. For a refusal, the approval's own blockers are the direct reason,
 * and the halting stage is added when it contributes something they do not — a
 * run can stop long before approval is reached, and "NOT_APPROVED" with no
 * codes would be useless to whoever reads it later.
 */
function blockersFor(run: PipelineRun): readonly string[] {
  if (run.approval.decision === "APPROVED_AUTOMATICALLY") {
    return Object.freeze([]) as readonly string[];
  }

  const codes: string[] = [...run.approval.blockers];

  const halted = run.stages.find((stage) => stage.status === "blocked");
  if (halted?.blocker && !codes.includes(halted.blocker)) {
    codes.push(halted.blocker);
  }

  return Object.freeze(codes);
}

/**
 * Build the record for a run.
 *
 * `headSha` is supplied by the caller rather than derived: the decision layer
 * is deliberately ignorant of git, and the commit a decision applies to is the
 * caller's fact to state.
 */
export function buildDecisionRecord(
  run: PipelineRun,
  context: {
    readonly projectId: string;
    readonly action: AutomaticAction;
    readonly authorId?: string | null;
    readonly approverId?: string | null;
    readonly headSha?: string | null;
  },
): AutonomyDecisionRecord {
  const blockers = blockersFor(run);

  return Object.freeze({
    projectId: context.projectId,
    action: context.action,
    decision: run.approval.decision,
    risk: run.assessment.level,
    riskEscalated: run.riskEscalated,
    headSha: context.headSha ?? null,
    authorId: context.authorId ?? null,
    // An approval by the change's own author is not an independent decision;
    // the database rejects it, and recording it here would misrepresent who
    // signed off. Drop it rather than write a claim the record cannot support.
    approverId:
      context.approverId && context.approverId !== context.authorId ? context.approverId : null,
    blockers,
    reachedStage: run.reachedStage,
    policyVersion: AUTONOMY_POLICY_VERSION,
  });
}

/**
 * Whether a record satisfies the constraints the audit table enforces.
 *
 * Checked here as well as in the database so a caller finds out before a
 * round trip, and so the rule is visible next to the code that builds the row
 * rather than only in a migration.
 */
export function isRecordableDecision(record: AutonomyDecisionRecord): boolean {
  const approved = record.decision === "APPROVED_AUTOMATICALLY";
  if (approved && record.blockers.length > 0) return false;
  if (!approved && record.blockers.length === 0) return false;
  if (approved && record.approverId !== null && record.approverId === record.authorId) return false;
  return true;
}
