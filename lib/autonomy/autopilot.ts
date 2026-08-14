import {
  isActionPermitted,
  type EffectiveAutonomyControls,
} from "@/lib/autonomy/controls";
import { compareRisk, type RiskLevel } from "@/lib/risk";

/**
 * Backlog Autopilot: decide what the loop *would* pick up next.
 *
 * This selects and orders work. It does not start it — starting anything needs
 * the `plan` action enabled and an executor, neither of which exists. Keeping
 * selection separate from execution means the ordering can be reviewed and
 * tested on its own, and a future worker inherits a decision it can explain.
 *
 * Exclusions are returned alongside the queue rather than silently filtered,
 * because "why didn't it pick that up?" is the question an operator actually
 * asks.
 */

export const WORK_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type WorkPriority = (typeof WORK_PRIORITIES)[number];

export interface BacklogCandidate {
  readonly id: string;
  readonly title: string;
  readonly priority: WorkPriority;
  readonly risk: RiskLevel;
  /** Ids of work that must be complete first. */
  readonly dependsOn?: readonly string[];
  /** True once the item is finished; satisfies other items' dependencies. */
  readonly completed?: boolean;
  /** Set when a human has parked the item. */
  readonly blocked?: boolean;
  readonly projectId: string;
}

export type ExclusionReason =
  | "ALREADY_COMPLETE"
  | "MANUALLY_BLOCKED"
  | "UNMET_DEPENDENCY"
  | "UNKNOWN_DEPENDENCY"
  | "ABOVE_RISK_CEILING"
  | "PLANNING_NOT_ENABLED"
  | "PROJECT_UNHEALTHY";

export interface ExcludedCandidate {
  readonly id: string;
  readonly reason: ExclusionReason;
  readonly detail: string;
}

export interface AutopilotSelection {
  /** Eligible work, most important first. */
  readonly queue: readonly BacklogCandidate[];
  readonly excluded: readonly ExcludedCandidate[];
  /** The item the loop would take, or null when nothing is eligible. */
  readonly next: BacklogCandidate | null;
  /** True when the queue is empty only because autonomy is held off. */
  readonly heldByControls: boolean;
}

export interface AutopilotInput {
  readonly candidates: readonly BacklogCandidate[];
  readonly controls: EffectiveAutonomyControls;
  /**
   * Project health from Phase 1E. Work is not selected for a project that is
   * degraded or worse — picking up a feature while production is on fire is
   * exactly the judgement an autopilot gets wrong.
   */
  readonly projectHealth?: Readonly<Record<string, "healthy" | "degraded" | "critical" | "unknown" | "paused">>;
}

const PRIORITY_RANK: Readonly<Record<WorkPriority, number>> = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
});

/** Health states that stop new work being picked up for a project. */
const UNHEALTHY = new Set(["degraded", "critical", "paused"]);

const EXCLUSION_DETAIL: Readonly<Record<ExclusionReason, string>> = Object.freeze({
  ALREADY_COMPLETE: "Already complete.",
  MANUALLY_BLOCKED: "Parked by a human.",
  UNMET_DEPENDENCY: "Waiting on unfinished work.",
  UNKNOWN_DEPENDENCY: "Depends on an item that is not in the backlog.",
  ABOVE_RISK_CEILING: "Riskier than the configured ceiling allows.",
  PLANNING_NOT_ENABLED: "Automatic planning is not enabled.",
  PROJECT_UNHEALTHY: "The project is not healthy enough to take on new work.",
});

/**
 * Order eligible work and explain every exclusion.
 *
 * Ordering is priority first, then *lower* risk first within a priority: given
 * two equally important items, the safer one goes first, so the loop builds
 * evidence on cheap work before it reaches for expensive work.
 *
 * When planning is disabled the whole backlog is excluded for that reason
 * alone, and `heldByControls` says so — that is a different situation from a
 * backlog with nothing eligible in it, and the interface should not show them
 * the same way.
 */
export function selectAutopilotWork({
  candidates,
  controls,
  projectHealth = {},
}: AutopilotInput): AutopilotSelection {
  const excluded: ExcludedCandidate[] = [];
  const exclude = (id: string, reason: ExclusionReason) => {
    excluded.push({ id, reason, detail: EXCLUSION_DETAIL[reason] });
  };

  const known = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const planningEnabled = controls.actions.plan;

  const eligible: BacklogCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.completed) {
      exclude(candidate.id, "ALREADY_COMPLETE");
      continue;
    }
    if (candidate.blocked) {
      exclude(candidate.id, "MANUALLY_BLOCKED");
      continue;
    }

    const health = projectHealth[candidate.projectId];
    if (health && UNHEALTHY.has(health)) {
      exclude(candidate.id, "PROJECT_UNHEALTHY");
      continue;
    }

    const dependencies = candidate.dependsOn ?? [];
    const unknown = dependencies.find((id) => !known.has(id));
    if (unknown !== undefined) {
      exclude(candidate.id, "UNKNOWN_DEPENDENCY");
      continue;
    }
    if (dependencies.some((id) => !known.get(id)?.completed)) {
      exclude(candidate.id, "UNMET_DEPENDENCY");
      continue;
    }

    if (compareRisk(candidate.risk, controls.maximumAutonomousRisk) > 0) {
      exclude(candidate.id, "ABOVE_RISK_CEILING");
      continue;
    }

    if (!planningEnabled || !isActionPermitted(controls, "plan", candidate.risk)) {
      exclude(candidate.id, "PLANNING_NOT_ENABLED");
      continue;
    }

    eligible.push(candidate);
  }

  const queue = [...eligible].sort((left, right) => {
    const byPriority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
    if (byPriority !== 0) return byPriority;
    // Same priority: take the safer one first.
    const byRisk = compareRisk(left.risk, right.risk);
    if (byRisk !== 0) return byRisk;
    return left.id.localeCompare(right.id);
  });

  const heldByControls =
    queue.length === 0 &&
    excluded.length > 0 &&
    excluded.every((entry) => entry.reason === "PLANNING_NOT_ENABLED");

  return Object.freeze({
    queue: Object.freeze(queue),
    excluded: Object.freeze(excluded),
    next: queue[0] ?? null,
    heldByControls,
  });
}
