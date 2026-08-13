import type { AgentReviewResult } from "@/lib/autonomy/agents";
import {
  isActionPermitted,
  type AutomaticAction,
  type EffectiveAutonomyControls,
} from "@/lib/autonomy/controls";
import type { GateEvaluation } from "@/lib/autonomy/gates";
import { RISK_DEFINITIONS, type RiskLevel } from "@/lib/risk";

/**
 * The approval decision for one proposed automatic action.
 *
 * Three outcomes, and only three:
 *
 * - `APPROVED_AUTOMATICALLY` — every condition held and the loop may proceed.
 * - `OWNER_APPROVAL_REQUIRED` — a human owner must decide. Not a refusal.
 * - `NOT_APPROVED` — something is wrong with the change itself. Fix it and retry.
 *
 * The distinction between the last two matters operationally: one waits for a
 * person, the other waits for a better change. Collapsing them would make the
 * loop retry things a person needs to see, and escalate things it could fix.
 */

export type ApprovalDecision =
  | "APPROVED_AUTOMATICALLY"
  | "OWNER_APPROVAL_REQUIRED"
  | "NOT_APPROVED";

export type ApprovalBlocker =
  | "AUTONOMOUS_MODE_OFF"
  | "ACTION_NOT_ENABLED"
  | "ABOVE_RISK_CEILING"
  | "GATES_NOT_SATISFIED"
  | "BLOCKING_FINDINGS"
  | "SELF_APPROVAL_REFUSED"
  | "OWNER_APPROVAL_MISSING"
  | "OWNER_APPROVAL_REJECTED"
  | "RISK_ESCALATED_SINCE_DECLARATION"
  | "EXECUTOR_NOT_CONNECTED";

export interface ApprovalRequest {
  readonly action: AutomaticAction;
  readonly risk: RiskLevel;
  readonly controls: EffectiveAutonomyControls;
  readonly gates: GateEvaluation;
  readonly agents: AgentReviewResult;
  /** Who produced the change. Compared against the approver. */
  readonly authorId: string;
  /** Who is recorded as approving, when an owner has acted. */
  readonly approverId?: string | null;
  readonly ownerApproval?: "NOT_REQUESTED" | "PENDING" | "APPROVED" | "REJECTED";
  /** True when the finished diff classified higher than it was declared. */
  readonly riskEscalated?: boolean;
}

export interface ApprovalResult {
  readonly decision: ApprovalDecision;
  readonly blockers: readonly ApprovalBlocker[];
  readonly reason: string;
  /** Recorded so an audit row can show what the decision was made against. */
  readonly evaluatedRisk: RiskLevel;
  readonly ownerApprovalRequired: boolean;
}

const REASONS: Readonly<Record<ApprovalBlocker, string>> = Object.freeze({
  AUTONOMOUS_MODE_OFF: "Autonomous mode is off.",
  ACTION_NOT_ENABLED: "This automatic action is not enabled for the project.",
  ABOVE_RISK_CEILING: "The change is riskier than the configured ceiling allows.",
  GATES_NOT_SATISFIED: "Required verification has not passed.",
  BLOCKING_FINDINGS: "A reviewing agent raised a blocking finding.",
  SELF_APPROVAL_REFUSED: "The author of a change may not approve it.",
  OWNER_APPROVAL_MISSING: "This action requires explicit owner approval.",
  OWNER_APPROVAL_REJECTED: "The owner rejected this action.",
  RISK_ESCALATED_SINCE_DECLARATION:
    "The finished diff is riskier than declared; it must be reclassified and re-gated.",
  EXECUTOR_NOT_CONNECTED: "No execution worker is connected.",
});

/**
 * Decide whether one action may proceed automatically.
 *
 * Ordering is deliberate and non-bypassable. Owner approval is checked *after*
 * the gates and the agents, so an owner cannot approve past a failing test or a
 * blocking security finding — approval answers "should this happen", never
 * "was this verified". A rejection by the owner is terminal for this attempt.
 *
 * The self-approval rule is absolute and applies at every risk level: whoever
 * authored the change is refused as its approver, even when they are the owner.
 * An owner who wants to approve their own change does so as a second, explicit,
 * separately attributed act, which is what makes the audit record meaningful.
 */
export function evaluateApproval(request: ApprovalRequest): ApprovalResult {
  const {
    action,
    risk,
    controls,
    gates,
    agents,
    authorId,
    approverId = null,
    ownerApproval = "NOT_REQUESTED",
    riskEscalated = false,
  } = request;

  const ownerApprovalRequired = RISK_DEFINITIONS[risk].ownerApprovalRequired;
  const blockers: ApprovalBlocker[] = [];

  // 1. Is the loop allowed to act at all?
  if (!controls.autonomousMode) blockers.push("AUTONOMOUS_MODE_OFF");
  if (controls.restrictions.includes("EXECUTOR_NOT_CONNECTED")) {
    blockers.push("EXECUTOR_NOT_CONNECTED");
  }
  if (!isActionPermitted(controls, action, risk)) {
    blockers.push(controls.actions[action] ? "ABOVE_RISK_CEILING" : "ACTION_NOT_ENABLED");
  }

  // 2. Is the change itself sound?
  if (riskEscalated) blockers.push("RISK_ESCALATED_SINCE_DECLARATION");
  if (!gates.satisfied) blockers.push("GATES_NOT_SATISFIED");
  if (!agents.clear) blockers.push("BLOCKING_FINDINGS");

  // 3. Who is approving, and may they?
  const selfApproving = approverId !== null && approverId === authorId;
  if (selfApproving) blockers.push("SELF_APPROVAL_REFUSED");

  if (ownerApprovalRequired) {
    if (ownerApproval === "REJECTED") {
      blockers.push("OWNER_APPROVAL_REJECTED");
    } else if (ownerApproval !== "APPROVED" || selfApproving) {
      blockers.push("OWNER_APPROVAL_MISSING");
    }
  }

  if (blockers.length === 0) {
    return Object.freeze({
      decision: "APPROVED_AUTOMATICALLY",
      blockers: Object.freeze([]) as readonly ApprovalBlocker[],
      reason: "Every gate, finding, control and approval condition is satisfied.",
      evaluatedRisk: risk,
      ownerApprovalRequired,
    });
  }

  /**
   * Only escalate to an owner when waiting for a person is the *whole* of what
   * is missing. A change with a failing gate is not an owner's decision to
   * make — sending it up would ask someone to approve work that has not been
   * verified, and a rejection already is a decision rather than an absent one.
   */
  const OWNER_BLOCKERS: readonly ApprovalBlocker[] = [
    "OWNER_APPROVAL_MISSING",
    "SELF_APPROVAL_REFUSED",
  ];
  const awaitingOwner =
    !blockers.includes("OWNER_APPROVAL_REJECTED") &&
    blockers.some((blocker) => OWNER_BLOCKERS.includes(blocker)) &&
    blockers.every((blocker) => OWNER_BLOCKERS.includes(blocker));

  const decision: ApprovalDecision = awaitingOwner ? "OWNER_APPROVAL_REQUIRED" : "NOT_APPROVED";

  return Object.freeze({
    decision,
    blockers: Object.freeze(blockers),
    reason: blockers.map((blocker) => REASONS[blocker]).join(" "),
    evaluatedRisk: risk,
    ownerApprovalRequired,
  });
}
