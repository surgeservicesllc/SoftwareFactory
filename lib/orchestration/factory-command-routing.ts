import { z } from "zod";

import {
  assignmentConfigSchema,
  assignmentPostingIsConfigured,
  normalizeAssignmentConfig,
  type AssignmentConfig,
} from "@/lib/bots/assignment-config";
import {
  orderRoutableAssignments,
  routeWorkToAssignedBot,
  type RefusalCode as AssignmentRefusalCode,
  type RoutableAssignment,
} from "@/lib/bots/assignment-routing";
import { isWithinRiskCeiling, type RiskLevel } from "@/lib/risk";

/**
 * The bounded projection returned by
 * `list_factory_command_routing_candidates`.
 *
 * The RPC is the trusted read boundary for facts that a browser-facing table
 * read cannot provide coherently: the selected pipeline, the bot posting,
 * role, effective provider/model, and the current in-flight count are read in
 * one database snapshot.  This parser deliberately rejects the whole read if
 * one row is malformed.  Skipping a malformed candidate could make a broken
 * projection look like an ordinary "no bot is available" setup refusal.
 */
const candidateRowSchema = z.object({
  project_pipeline_id: z.string().uuid(),
  pipeline_template_key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  pipeline_template_id: z.string().uuid().nullable(),
  assignment_id: z.string().uuid(),
  bot_id: z.string().uuid(),
  bot_name: z.string().trim().min(1).max(80),
  role_id: z.string().uuid(),
  role_slug: z.string().trim().min(1).max(80),
  role_risk_ceiling: z.enum(["green", "yellow", "red"]),
  assignment_status: z.enum(["active", "paused", "released"]),
  current_readiness: z.enum(["not_connected", "ready", "blocked", "disabled"]),
  ai_account_status: z.string().trim().min(1).max(40).nullable(),
  provider: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(128),
  assignment_model: z.string().trim().min(1).max(128).nullable(),
  work_effort: z.enum(["low", "medium", "high", "max"]),
  assignment_config: z.unknown(),
  assigned_pipeline_keys: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)).max(100),
  in_flight: z.number().int().min(0),
  max_concurrent_tasks: z.number().int().min(1).max(10),
  has_capacity: z.boolean(),
  is_configured: z.boolean(),
  assigned_at: z.string().datetime({ offset: true }),
}).strict();

type CandidateRow = z.infer<typeof candidateRowSchema>;

export interface FactoryCommandRoutingCandidate {
  readonly projectPipelineId: string;
  readonly pipelineTemplateKey: string;
  readonly pipelineTemplateId: string | null;
  readonly assignmentId: string;
  readonly botId: string;
  readonly botName: string;
  readonly roleId: string;
  readonly roleSlug: string;
  readonly roleRiskCeiling: RiskLevel;
  readonly status: "active" | "paused" | "released";
  readonly currentReadiness: "not_connected" | "ready" | "blocked" | "disabled";
  readonly aiAccountStatus: string | null;
  readonly provider: string;
  readonly model: string;
  readonly assignmentModel: string | null;
  readonly workEffort: "low" | "medium" | "high" | "max";
  readonly config: AssignmentConfig;
  readonly assignedPipelineKeys: readonly string[];
  readonly inFlight: number;
  readonly hasCapacity: boolean;
  readonly isConfigured: boolean;
  readonly assignedAt: string;
}

export class FactoryCommandCandidateProjectionError extends Error {
  constructor(message = "The factory command routing projection is invalid.") {
    super(message);
    this.name = "FactoryCommandCandidateProjectionError";
  }
}

function toRiskLevel(value: CandidateRow["role_risk_ceiling"]): RiskLevel {
  return value.toUpperCase() as RiskLevel;
}

/** Parse and normalize the database projection without accepting partial rows. */
export function parseFactoryCommandRoutingCandidates(
  value: unknown,
): readonly FactoryCommandRoutingCandidate[] {
  const parsed = z.array(candidateRowSchema).max(200).safeParse(value);
  if (!parsed.success) throw new FactoryCommandCandidateProjectionError();

  return Object.freeze(parsed.data.map((row) => {
    const configInput = assignmentConfigSchema.safeParse(row.assignment_config);
    if (!configInput.success) throw new FactoryCommandCandidateProjectionError();

    let config: AssignmentConfig;
    try {
      config = normalizeAssignmentConfig(configInput.data);
    } catch {
      throw new FactoryCommandCandidateProjectionError();
    }

    // The duplicated scalar is intentional in the RPC: it lets SQL enforce
    // and expose capacity without asking application code to reconstruct a
    // database expression.  A disagreement is projection drift, not a bot
    // setup state, so fail the read rather than selecting from it.
    if (row.max_concurrent_tasks !== config.maxConcurrentTasks) {
      throw new FactoryCommandCandidateProjectionError();
    }

    return Object.freeze({
      projectPipelineId: row.project_pipeline_id,
      pipelineTemplateKey: row.pipeline_template_key,
      pipelineTemplateId: row.pipeline_template_id,
      assignmentId: row.assignment_id,
      botId: row.bot_id,
      botName: row.bot_name,
      roleId: row.role_id,
      roleSlug: row.role_slug,
      roleRiskCeiling: toRiskLevel(row.role_risk_ceiling),
      status: row.assignment_status,
      currentReadiness: row.current_readiness,
      aiAccountStatus: row.ai_account_status,
      provider: row.provider,
      model: row.model,
      assignmentModel: row.assignment_model,
      workEffort: row.work_effort,
      config,
      assignedPipelineKeys: Object.freeze([...row.assigned_pipeline_keys]),
      inFlight: row.in_flight,
      hasCapacity: row.has_capacity,
      // Both boundaries decide this independently.  Requiring both prevents
      // either implementation from widening the other during a rolling
      // deployment; the atomic submit RPC repeats the database decision.
      isConfigured: row.is_configured && assignmentPostingIsConfigured({
        config,
        model: row.assignment_model,
        workEffort: row.work_effort,
      }),
      assignedAt: row.assigned_at,
    });
  }));
}

export const FACTORY_COMMAND_REFUSAL_CODES = [
  "NO_ASSIGNED_BOTS",
  "ASSIGNMENT_NOT_CONFIGURED",
  "BOT_NOT_READY",
  "ROLE_RISK_CEILING_TOO_LOW",
  "PROVIDER_MODEL_MISMATCH",
  "DATABASE_CAPACITY_REFUSED",
  "PIPELINE_SCOPE_MISMATCH",
  ...[
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
  ] satisfies readonly AssignmentRefusalCode[],
] as const;

export type FactoryCommandRefusalCode = (typeof FACTORY_COMMAND_REFUSAL_CODES)[number];

export interface FactoryCommandCandidateRefusal {
  readonly assignmentId: string | null;
  readonly botName: string | null;
  readonly code: FactoryCommandRefusalCode;
  readonly reason: string;
}

export type FactoryCommandRoutingDecision =
  | {
      readonly outcome: "SELECTED";
      readonly selected: FactoryCommandRoutingCandidate;
      readonly eligibleCount: number;
      readonly refused: readonly FactoryCommandCandidateRefusal[];
    }
  | {
      readonly outcome: "REFUSED";
      readonly selected: null;
      readonly eligibleCount: 0;
      readonly refused: readonly FactoryCommandCandidateRefusal[];
      readonly reason: string;
    };

function refusal(
  candidate: FactoryCommandRoutingCandidate,
  code: FactoryCommandRefusalCode,
  reason: string,
): FactoryCommandCandidateRefusal {
  return Object.freeze({
    assignmentId: candidate.assignmentId,
    botName: candidate.botName,
    code,
    reason,
  });
}

function routable(candidate: FactoryCommandRoutingCandidate): RoutableAssignment {
  return {
    assignmentId: candidate.assignmentId,
    botId: candidate.botId,
    botName: candidate.botName,
    roleId: candidate.roleId,
    status: candidate.status,
    config: candidate.config,
    inFlight: candidate.inFlight,
    assignedAt: candidate.assignedAt,
  };
}

function assignmentRefusal(
  candidate: FactoryCommandRoutingCandidate,
  result: ReturnType<typeof routeWorkToAssignedBot>,
): FactoryCommandCandidateRefusal {
  const first = result.refused[0];
  return refusal(
    candidate,
    first?.code ?? "PIPELINE_SCOPE_MISMATCH",
    first?.reason ?? result.reason,
  );
}

/**
 * Select one bot posting for a static Phase 1C draft-PR command.
 *
 * Every property besides ordering is a gate.  Priority and headroom can order
 * eligible postings, but they can never compensate for a missing permission,
 * a low role ceiling, unavailable credentials, or a provider/model mismatch.
 * Final ordering uses the assignment router's ordering policy, so this path
 * and the rest of the bot fabric share one deterministic tie-break policy.
 */
export function routeFactoryCommand(input: {
  readonly candidates: readonly FactoryCommandRoutingCandidate[];
  readonly pipelineTemplateKey: string;
  readonly effectiveRisk: RiskLevel;
  readonly provider: string;
  readonly model: string;
  /**
   * A same-key replay has to reach the atomic RPC: that boundary verifies the
   * immutable existing route before checking capacity. Every non-capacity
   * gate remains local and fail-closed; a fresh key still rolls back there.
   */
  readonly deferCapacityToAtomicSubmit?: boolean;
}): FactoryCommandRoutingDecision {
  if (input.candidates.length === 0) {
    const empty = Object.freeze({
      assignmentId: null,
      botName: null,
      code: "NO_ASSIGNED_BOTS" as const,
      reason: "No bots are assigned to this project.",
    });
    return Object.freeze({
      outcome: "REFUSED" as const,
      selected: null,
      eligibleCount: 0 as const,
      refused: Object.freeze([empty]),
      reason: empty.reason,
    });
  }

  const eligible: FactoryCommandRoutingCandidate[] = [];
  const capacityDeferred: FactoryCommandRoutingCandidate[] = [];
  const refused: FactoryCommandCandidateRefusal[] = [];

  for (const candidate of input.candidates) {
    if (candidate.pipelineTemplateKey !== input.pipelineTemplateKey) {
      refused.push(refusal(
        candidate,
        "PIPELINE_SCOPE_MISMATCH",
        "This routing candidate belongs to a different selected pipeline.",
      ));
      continue;
    }

    if (!candidate.isConfigured) {
      refused.push(refusal(
        candidate,
        "ASSIGNMENT_NOT_CONFIGURED",
        "This bot assignment has not been configured.",
      ));
      continue;
    }

    if (
      candidate.currentReadiness !== "ready"
      || (candidate.aiAccountStatus !== null && candidate.aiAccountStatus !== "connected")
    ) {
      refused.push(refusal(candidate, "BOT_NOT_READY", "This bot is not ready to run work."));
      continue;
    }

    if (!isWithinRiskCeiling(input.effectiveRisk, candidate.roleRiskCeiling)) {
      refused.push(refusal(
        candidate,
        "ROLE_RISK_CEILING_TOO_LOW",
        `This bot role's ${candidate.roleRiskCeiling} risk ceiling is below ${input.effectiveRisk}.`,
      ));
      continue;
    }

    if (candidate.provider !== input.provider || candidate.model !== input.model) {
      refused.push(refusal(
        candidate,
        "PROVIDER_MODEL_MISMATCH",
        "This bot does not match the command's fixed execution provider and model.",
      ));
      continue;
    }

    const assignment = routable(candidate);
    const pullRequest = routeWorkToAssignedBot({
      assignments: [assignment],
      work: { kind: "pull_request" },
    });
    const pullRequestOnlyHitCapacity = pullRequest.refused.length === 1
      && pullRequest.refused[0]?.code === "AT_CONCURRENCY_LIMIT";
    if (
      !pullRequest.selected
      && !(input.deferCapacityToAtomicSubmit && pullRequestOnlyHitCapacity)
    ) {
      refused.push(assignmentRefusal(candidate, pullRequest));
      continue;
    }
    let capacityOnlyRefusal = !pullRequest.selected && pullRequestOnlyHitCapacity;

    const pipeline = routeWorkToAssignedBot({
      assignments: [assignment],
      work: {
        kind: "pipeline_run",
        pipelineId: input.pipelineTemplateKey,
        assignedPipelineIds: candidate.assignedPipelineKeys,
      },
    });
    const pipelineOnlyHitCapacity = pipeline.refused.length === 1
      && pipeline.refused[0]?.code === "AT_CONCURRENCY_LIMIT";
    if (!pipeline.selected && !(input.deferCapacityToAtomicSubmit && pipelineOnlyHitCapacity)) {
      refused.push(assignmentRefusal(candidate, pipeline));
      continue;
    }
    capacityOnlyRefusal ||= !pipeline.selected && pipelineOnlyHitCapacity;

    // `hasCapacity` is the database's authoritative verdict and may grow to
    // include gates that are not expressible in the local assignment policy.
    // The local router already checked the assignment count; strictest wins.
    if (!candidate.hasCapacity && !input.deferCapacityToAtomicSubmit) {
      refused.push(refusal(
        candidate,
        "DATABASE_CAPACITY_REFUSED",
        "This bot assignment is at its concurrency limit.",
      ));
      continue;
    }

    capacityOnlyRefusal ||= !candidate.hasCapacity;

    if (capacityOnlyRefusal) capacityDeferred.push(candidate);
    else eligible.push(candidate);
  }

  const selectionPool = eligible.length > 0 ? eligible : capacityDeferred;
  if (selectionPool.length === 0) {
    return Object.freeze({
      outcome: "REFUSED" as const,
      selected: null,
      eligibleCount: 0 as const,
      refused: Object.freeze(refused),
      reason: "No active, configured, ready bot assignment can run this pipeline command.",
    });
  }

  const routableEligible = selectionPool.map(routable);
  const selectedId = eligible.length === 0
    ? orderRoutableAssignments(routableEligible)[0]?.assignmentId
    : routeWorkToAssignedBot({
        assignments: routableEligible,
        work: { kind: "pull_request" },
      }).selected?.assignmentId;
  const selected = selectionPool.find((candidate) => candidate.assignmentId === selectedId);
  if (!selected) {
    throw new FactoryCommandCandidateProjectionError(
      "Eligible factory routing candidates did not produce a deterministic selection.",
    );
  }

  return Object.freeze({
    outcome: "SELECTED" as const,
    selected,
    eligibleCount: selectionPool.length,
    refused: Object.freeze(refused),
  });
}
