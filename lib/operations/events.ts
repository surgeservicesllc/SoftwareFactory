import type { OperationsEventType } from "@/lib/operations/types";

/**
 * What each real operations event is supposed to cause.
 *
 * Declaring the orchestration as data keeps two things honest at once: the
 * actions that genuinely run in this phase, and the ones that are deferred
 * because their executor is Not Connected. A handler that quietly did nothing
 * would look identical to a handler that worked.
 */

export type OperationsAction =
  | "recompute_project_health"
  | "freeze_autonomous_releases"
  | "open_or_update_incident"
  | "evaluate_rollback_eligibility"
  | "create_repair_work"
  | "escalate_to_owner"
  | "execute_rollback"
  | "execute_repair"
  | "execute_deployment";

export interface OperationsActionPlan {
  readonly action: OperationsAction;
  /** True when this phase actually performs the action. */
  readonly implemented: boolean;
  readonly note: string;
}

function plan(
  action: OperationsAction,
  implemented: boolean,
  note: string,
): OperationsActionPlan {
  return Object.freeze({ action, implemented, note });
}

const RECOMPUTE: OperationsActionPlan = plan(
  "recompute_project_health",
  true,
  "Derives health from current real signals and appends a history entry.",
);

const EXECUTE_ROLLBACK = plan(
  "execute_rollback",
  false,
  "No deployment provider adapter is connected, so no rollback is performed.",
);

const EXECUTE_REPAIR = plan(
  "execute_repair",
  false,
  "No code-execution worker is connected, so repair work is created but not run.",
);

const OPEN_INCIDENT = plan(
  "open_or_update_incident",
  true,
  "A breached failure threshold opens or deduplicates into one incident.",
);

const ESCALATE = plan(
  "escalate_to_owner",
  true,
  "Failure past the bounded limit escalates to the owner instead of retrying.",
);

export const OPERATIONS_EVENT_PLAN: Readonly<
  Record<OperationsEventType, readonly OperationsActionPlan[]>
> = Object.freeze({
  "health.failed": Object.freeze([RECOMPUTE, OPEN_INCIDENT]),
  "synthetic.failed": Object.freeze([RECOMPUTE, OPEN_INCIDENT]),
  "deployment.failed": Object.freeze([RECOMPUTE, EXECUTE_ROLLBACK]),
  "deployment.degraded": Object.freeze([RECOMPUTE]),
  "incident.created": Object.freeze([
    RECOMPUTE,
    plan(
      "freeze_autonomous_releases",
      true,
      "A SEV1 or SEV2 incident freezes autonomous releases immediately.",
    ),
    plan(
      "evaluate_rollback_eligibility",
      true,
      "Eligibility is evaluated and recorded; execution remains blocked.",
    ),
  ]),
  "rollback.started": Object.freeze([RECOMPUTE, EXECUTE_ROLLBACK]),
  "rollback.completed": Object.freeze([RECOMPUTE, ESCALATE]),
  "repair.started": Object.freeze([
    RECOMPUTE,
    plan("create_repair_work", true, "Bounded repair work is created and left unassigned."),
    EXECUTE_REPAIR,
  ]),
  "repair.failed": Object.freeze([RECOMPUTE, ESCALATE]),
  "incident.resolved": Object.freeze([RECOMPUTE]),
});

export function plannedActions(eventType: OperationsEventType): readonly OperationsActionPlan[] {
  return OPERATIONS_EVENT_PLAN[eventType] ?? Object.freeze([RECOMPUTE]);
}

export function isOperationsEventType(value: unknown): value is OperationsEventType {
  return typeof value === "string" && value in OPERATIONS_EVENT_PLAN;
}
