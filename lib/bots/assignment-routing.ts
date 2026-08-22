import {
  type AssignmentConfig,
} from "@/lib/bots/assignment-config";

/**
 * Which of a project's assigned bots may take a given piece of work.
 *
 * The configuration a person set in the assign wizard has to decide something,
 * or it is decoration. This is the module that makes it decide: a bot that was
 * given read access never routes a code change, a bot with no pipeline access
 * never routes a pipeline run, and a paused bot routes nothing at all.
 *
 * Three deliberate shapes.
 *
 * **Gates, not weights.** Permission is an eligibility test evaluated before
 * any ordering. A scoring model could let priority or idleness outvote a
 * missing permission, which is exactly the property a permission must not have.
 *
 * **Every refusal is named.** Told only "no bot is available", an operator
 * cannot tell a permission problem from a full fleet from a paused roster, and
 * will change the wrong thing. Each excluded bot carries the code and a
 * sentence.
 *
 * **It selects; it does not start.** This returns a decision. No claim, no
 * lease, no credential, no provider call — the caller owns all of that, and
 * `policies/AUTO_MERGE_POLICY.md` still governs whether anything may act on it.
 * Approval-gated work is returned *with* `requiresApproval` set rather than
 * filtered out, because a decision nobody can see cannot be approved.
 */

/** What a piece of work needs in order to be done at all. */
export const WORK_KINDS = [
  "analysis",
  "code_change",
  "pull_request",
  "pull_request_merge",
  "pipeline_run",
  "production_change",
] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

export interface RoutableAssignment {
  readonly assignmentId: string;
  readonly botId: string;
  readonly botName: string;
  readonly roleId: string;
  readonly status: "active" | "paused" | "released";
  readonly config: AssignmentConfig;
  /** Tasks this assignment is already running, counted by the caller. */
  readonly inFlight: number;
  /** Tie-breaker so two equal-priority bots resolve in a stable order. */
  readonly assignedAt: string;
}

export interface WorkItem {
  readonly kind: WorkKind;
  /** Pipeline id when the work is a pipeline run; matched against scope. */
  readonly pipelineId?: string | null;
  /** Pipelines the bot's role covers, when its access is `assigned`. */
  readonly assignedPipelineIds?: readonly string[];
  /** Paths the work will touch, used to detect a conflicting hold. */
  readonly paths?: readonly string[];
}

export const REFUSAL_CODES = [
  "ASSIGNMENT_PAUSED",
  "ASSIGNMENT_RELEASED",
  "REPOSITORY_WRITE_REQUIRED",
  "PULL_REQUEST_PERMISSION_REQUIRED",
  "MERGE_PERMISSION_REQUIRED",
  "PIPELINE_ACCESS_REQUIRED",
  "PIPELINE_OUT_OF_SCOPE",
  "PRODUCTION_ACCESS_REQUIRED",
  "AT_CONCURRENCY_LIMIT",
  "PATH_HELD_BY_ANOTHER_BOT",
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

export interface Refusal {
  readonly assignmentId: string;
  readonly botName: string;
  readonly code: RefusalCode;
  readonly reason: string;
}

export interface RoutingResult {
  readonly selected: RoutableAssignment | null;
  /** Eligible bots in the order they would be offered the work. */
  readonly eligible: readonly RoutableAssignment[];
  readonly refused: readonly Refusal[];
  /**
   * True when the selected bot's configuration requires a person before its
   * work lands. Carried out rather than resolved here: this module decides who
   * could do the work, not whether anyone has said yes.
   */
  readonly requiresApproval: boolean;
  readonly reason: string;
}

/** A path currently held by some bot, from `task_work_locks`. */
export interface HeldPath {
  readonly path: string;
  readonly assignmentId: string;
  readonly botName: string;
}

function refuse(
  assignment: RoutableAssignment,
  code: RefusalCode,
  reason: string,
): Refusal {
  return Object.freeze({
    assignmentId: assignment.assignmentId,
    botName: assignment.botName,
    code,
    reason,
  });
}

/**
 * Does this assignment's grant cover this kind of work?
 *
 * Returns the refusal code rather than a boolean so the caller can say which
 * permission was missing. Ordered from the broadest requirement inward, so the
 * reported reason is the first thing someone would have to change.
 */
function permissionRefusal(
  config: AssignmentConfig,
  work: WorkItem,
): { code: RefusalCode; reason: string } | null {
  switch (work.kind) {
    case "analysis":
      return null;

    case "code_change":
      return config.repositoryAccess === "write"
        ? null
        : { code: "REPOSITORY_WRITE_REQUIRED", reason: "This bot cannot write to the repository." };

    case "pull_request":
      if (config.repositoryAccess !== "write") {
        return {
          code: "REPOSITORY_WRITE_REQUIRED",
          reason: "This bot cannot write to the repository.",
        };
      }
      return config.canOpenPullRequest
        ? null
        : {
          code: "PULL_REQUEST_PERMISSION_REQUIRED",
          reason: "This bot may not open pull requests.",
        };

    case "pull_request_merge":
      if (!config.canOpenPullRequest) {
        return {
          code: "PULL_REQUEST_PERMISSION_REQUIRED",
          reason: "This bot may not open pull requests.",
        };
      }
      return config.canMergePullRequest
        ? null
        : { code: "MERGE_PERMISSION_REQUIRED", reason: "This bot may not merge pull requests." };

    case "pipeline_run":
      if (config.pipelineAccess === "none") {
        return { code: "PIPELINE_ACCESS_REQUIRED", reason: "This bot has no pipeline access." };
      }
      if (config.pipelineAccess === "assigned") {
        const scope = work.assignedPipelineIds ?? [];
        // An `assigned` scope with nothing in it grants nothing. Treating an
        // empty scope as "everything" would make the narrower setting the
        // wider one, which is the wrong direction for a permission to fail.
        if (!work.pipelineId || !scope.includes(work.pipelineId)) {
          return {
            code: "PIPELINE_OUT_OF_SCOPE",
            reason: "This pipeline is outside the bot's assigned pipelines.",
          };
        }
      }
      return null;

    case "production_change":
      return config.environmentAccess === "production"
        ? null
        : { code: "PRODUCTION_ACCESS_REQUIRED", reason: "This bot cannot reach production." };

    default: {
      // A new work kind must not become universally permitted by omission.
      const exhaustive: never = work.kind;
      return {
        code: "REPOSITORY_WRITE_REQUIRED",
        reason: `Unknown work kind: ${String(exhaustive)}`,
      };
    }
  }
}

/**
 * Orders eligible bots: urgency first, then the one carrying least, then the
 * longest-serving. Load is the second term rather than the first because a P0
 * bot that is busy still outranks an idle P3 one — otherwise idleness quietly
 * becomes the priority system.
 */
function compareCandidates(left: RoutableAssignment, right: RoutableAssignment): number {
  if (left.config.priority !== right.config.priority) {
    return left.config.priority - right.config.priority;
  }
  const leftHeadroom = left.config.maxConcurrentTasks - left.inFlight;
  const rightHeadroom = right.config.maxConcurrentTasks - right.inFlight;
  if (leftHeadroom !== rightHeadroom) return rightHeadroom - leftHeadroom;
  if (left.assignedAt !== right.assignedAt) {
    return left.assignedAt < right.assignedAt ? -1 : 1;
  }
  return left.assignmentId < right.assignmentId ? -1 : 1;
}

/**
 * Applies the router's stable ordering without changing eligibility facts.
 * Callers that already established eligibility in another authoritative
 * boundary can reuse the exact tie-break policy without inventing capacity.
 */
export function orderRoutableAssignments(
  assignments: readonly RoutableAssignment[],
): readonly RoutableAssignment[] {
  return Object.freeze([...assignments].sort(compareCandidates));
}

/**
 * Chooses which assigned bot should take one piece of work.
 *
 * `heldPaths` is how two bots are kept off the same files. It comes from
 * `task_work_locks`, whose leases expire — so a lock whose holder died stops
 * blocking on a bounded clock rather than freezing the project. A hold by the
 * *same* assignment is not a conflict: that is the bot's own work continuing.
 */
export function routeWorkToAssignedBot(input: {
  readonly assignments: readonly RoutableAssignment[];
  readonly work: WorkItem;
  readonly heldPaths?: readonly HeldPath[];
}): RoutingResult {
  const refused: Refusal[] = [];
  const eligible: RoutableAssignment[] = [];
  const wantedPaths = new Set(input.work.paths ?? []);

  for (const assignment of input.assignments) {
    if (assignment.status === "released") {
      refused.push(
        refuse(assignment, "ASSIGNMENT_RELEASED", "This bot is no longer on the project."),
      );
      continue;
    }
    if (assignment.status === "paused") {
      refused.push(refuse(assignment, "ASSIGNMENT_PAUSED", "This bot is paused."));
      continue;
    }

    const missing = permissionRefusal(assignment.config, input.work);
    if (missing) {
      refused.push(refuse(assignment, missing.code, missing.reason));
      continue;
    }

    // Capacity is a gate beside permission, never a score weight: a bot that
    // is full cannot take the work however well it otherwise fits.
    if (assignment.inFlight >= assignment.config.maxConcurrentTasks) {
      refused.push(
        refuse(
          assignment,
          "AT_CONCURRENCY_LIMIT",
          `This bot is already running ${assignment.inFlight} of ${assignment.config.maxConcurrentTasks} tasks.`,
        ),
      );
      continue;
    }

    const conflict = (input.heldPaths ?? []).find(
      (held) => wantedPaths.has(held.path) && held.assignmentId !== assignment.assignmentId,
    );
    if (conflict) {
      refused.push(
        refuse(
          assignment,
          "PATH_HELD_BY_ANOTHER_BOT",
          `${conflict.botName} is already working on ${conflict.path}.`,
        ),
      );
      continue;
    }

    eligible.push(assignment);
  }

  const ordered = orderRoutableAssignments(eligible);
  const selected = ordered[0] ?? null;

  return Object.freeze({
    selected,
    eligible: ordered,
    refused: Object.freeze(refused),
    requiresApproval: selected ? selected.config.requiresHumanApproval : false,
    reason: selected
      ? `${selected.botName} is the highest-priority assigned bot permitted to do this work.`
      : input.assignments.length === 0
        ? "No bots are assigned to this project."
        : "No assigned bot is permitted and free to do this work.",
  });
}

export interface DispatchAssignment {
  readonly work: WorkItem;
  readonly workId: string;
  readonly assignment: RoutableAssignment;
  readonly requiresApproval: boolean;
}

export interface DispatchResult {
  readonly dispatched: readonly DispatchAssignment[];
  readonly deferred: readonly { readonly workId: string; readonly reason: string }[];
}

/**
 * Routes a whole batch of work across the project's bots, in parallel.
 *
 * Not a loop over the single decision: each dispatch consumes capacity and
 * claims paths, and routing every item against the state at the *start* of the
 * batch would hand the same last slot — or the same file — to two bots. The
 * running tallies are threaded forward, which is the whole difference between
 * "several bots work at once" and "several bots collide".
 */
export function dispatchWorkAcrossBots(input: {
  readonly assignments: readonly RoutableAssignment[];
  readonly work: readonly { readonly workId: string; readonly item: WorkItem }[];
  readonly heldPaths?: readonly HeldPath[];
}): DispatchResult {
  const dispatched: DispatchAssignment[] = [];
  const deferred: { workId: string; reason: string }[] = [];

  const load = new Map(
    input.assignments.map((assignment) => [assignment.assignmentId, assignment.inFlight]),
  );
  const external: readonly HeldPath[] = input.heldPaths ?? [];

  /*
   * Paths this batch has already handed out, tracked apart from the leases
   * that existed before it.
   *
   * The two are not the same kind of hold. An existing lease belongs to work
   * already under way, so its own bot may continue into it. A claim made
   * moments ago in this batch belongs to work that has not started, and giving
   * a second item the same file blocks *whoever* asks — including the bot that
   * took the first one, which would otherwise run both in parallel against the
   * same file and overwrite itself.
   */
  const claimedInBatch = new Map<string, string>();

  for (const entry of input.work) {
    const paths = entry.item.paths ?? [];
    const collision = paths.find((path) => claimedInBatch.has(path));
    if (collision) {
      deferred.push({
        workId: entry.workId,
        reason: `${claimedInBatch.get(collision)} was just given ${collision} in this batch.`,
      });
      continue;
    }

    const withCurrentLoad = input.assignments.map((assignment) => ({
      ...assignment,
      inFlight: load.get(assignment.assignmentId) ?? assignment.inFlight,
    }));

    const result = routeWorkToAssignedBot({
      assignments: withCurrentLoad,
      work: entry.item,
      heldPaths: external,
    });

    if (!result.selected) {
      deferred.push({ workId: entry.workId, reason: result.reason });
      continue;
    }

    const chosen = result.selected;
    load.set(chosen.assignmentId, (load.get(chosen.assignmentId) ?? 0) + 1);
    for (const path of paths) claimedInBatch.set(path, chosen.botName);

    dispatched.push({
      work: entry.item,
      workId: entry.workId,
      assignment: chosen,
      requiresApproval: result.requiresApproval,
    });
  }

  return Object.freeze({
    dispatched: Object.freeze(dispatched),
    deferred: Object.freeze(deferred),
  });
}
