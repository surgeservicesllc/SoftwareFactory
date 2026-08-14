import "server-only";

import {
  FAULT_THRESHOLDS,
  closedBreaker,
  type BreakerFault,
  type BreakerRecord,
  type BreakerState,
} from "@/lib/resources/breakers";
import type { ResourceAssignment } from "@/lib/resources/manager";

/**
 * Durable memory for the Resource Manager.
 *
 * `lib/resources/breakers.ts` and `lib/resources/manager.ts` are pure functions
 * over inputs, which is what makes them testable — and also what made them
 * useless on their own. A breaker folded over a record nobody stored starts
 * closed on every request, so three consecutive outages spread across three
 * requests never reach a threshold of three. The breaker that exists to stop a
 * failing provider absorbing work could not fire.
 *
 * This module is the missing half: it reads the stored record before a decision
 * and writes the observed outcome after one. The *rules* stay in the pure
 * modules — thresholds are passed to the database rather than duplicated there,
 * so the two cannot disagree about when a breaker opens.
 *
 * Every function here fails soft on a read and hard on a write. A breaker whose
 * state cannot be read must not block work: the honest fallback is "no observed
 * failures", which is what a closed breaker already means. A fault that cannot
 * be recorded, by contrast, is a lost observation, and swallowing it would let
 * a failing provider look healthy forever.
 */

/**
 * The narrow slice of the Supabase client this module uses.
 *
 * Exported so a caller can widen its real client to exactly this. Structurally
 * checking the full generated client against it makes the inferred union deep
 * enough that TypeScript gives up (TS2589), and the honest fix is to say which
 * two methods are needed rather than to drag the whole surface through.
 */
export interface SupabaseLike {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

type BreakerRow = {
  target: string;
  state: BreakerState;
  fault: BreakerFault | null;
  consecutive_faults: number;
  opened_at: string | null;
  reason: string | null;
};

/**
 * Load every stored breaker for an organization, keyed by target.
 *
 * Returns an empty map when the table cannot be read — including when the
 * migration is not yet applied to the database in front of us. A caller then
 * sees `closedBreaker` for every target, which claims no health it has not
 * observed: closed means "nothing has failed here", not "this is known good".
 */
export async function loadBreakers(
  client: SupabaseLike,
  organizationId: string,
): Promise<ReadonlyMap<string, BreakerRecord>> {
  const { data, error } = await client
    .from("resource_breakers")
    .select("target,state,fault,consecutive_faults,opened_at,reason")
    .eq("organization_id", organizationId);

  if (error || !Array.isArray(data)) return new Map();

  const records = new Map<string, BreakerRecord>();
  for (const row of data as BreakerRow[]) {
    records.set(
      row.target,
      Object.freeze({
        target: row.target,
        state: row.state,
        fault: row.fault,
        consecutiveFaults: row.consecutive_faults,
        // The pure module compares against `Date.now()`, so the stored
        // timestamp has to arrive as epoch milliseconds, not as a string.
        openedAt: row.opened_at === null ? null : Date.parse(row.opened_at),
        reason: row.reason,
      }),
    );
  }
  return records;
}

/** The stored breaker for one target, or a closed one when nothing has failed. */
export function breakerFor(
  records: ReadonlyMap<string, BreakerRecord>,
  target: string,
): BreakerRecord {
  return records.get(target) ?? closedBreaker(target);
}

export interface BreakerFaultOutcome {
  readonly state: BreakerState;
  readonly consecutiveFaults: number;
  readonly opened: boolean;
  readonly reason: string | null;
}

/**
 * Record one observed fault.
 *
 * The threshold comes from `FAULT_THRESHOLDS` rather than from a copy in SQL,
 * so changing the rule in one place changes it everywhere. The read-modify-write
 * happens in the database under a row lock, because two concurrent requests
 * folding the same breaker in application memory would each read the old count
 * and one increment would be lost.
 */
export async function recordBreakerFault(
  client: SupabaseLike,
  organizationId: string,
  target: string,
  fault: BreakerFault,
): Promise<BreakerFaultOutcome> {
  const { data, error } = await client.rpc("record_resource_breaker_fault", {
    p_organization_id: organizationId,
    p_target: target,
    p_fault: fault,
    p_threshold: FAULT_THRESHOLDS[fault],
  });

  if (error) throw new Error(`the circuit breaker fault could not be recorded: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { state: BreakerState; consecutive_faults: number; opened: boolean; reason: string | null }
    | undefined;
  if (!row) throw new Error("the circuit breaker fault could not be recorded");

  return Object.freeze({
    state: row.state,
    consecutiveFaults: row.consecutive_faults,
    opened: row.opened,
    reason: row.reason,
  });
}

/** Record one observed success, which closes the breaker outright. */
export async function recordBreakerSuccess(
  client: SupabaseLike,
  organizationId: string,
  target: string,
): Promise<{ readonly closed: boolean }> {
  const { data, error } = await client.rpc("record_resource_breaker_success", {
    p_organization_id: organizationId,
    p_target: target,
  });

  if (error) throw new Error(`the circuit breaker success could not be recorded: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as { closed: boolean } | undefined;
  return Object.freeze({ closed: row?.closed === true });
}

/** Candidate evidence is capped so one decision cannot store an unbounded blob. */
const MAX_STORED_CANDIDATES = 20;
const MAX_STORED_REASONS = 10;

/**
 * Persist one routing decision.
 *
 * The stored candidate evidence is deliberately narrow: identity, eligibility,
 * score, and the *named* rejection and note codes. No provider output, no
 * intermediate reasoning, and no free text that did not originate here.
 *
 * A prediction is stored only when it was evidenced. `history.ts` returns null
 * below its minimum sample count precisely so nothing invents a success rate;
 * writing one anyway would launder a guess into the record that later outcomes
 * are measured against.
 */
export async function recordAssignment(
  client: SupabaseLike,
  input: {
    readonly projectId: string;
    readonly nodeId: string;
    readonly assignment: ResourceAssignment;
  },
): Promise<string> {
  const { assignment } = input;

  const candidates = assignment.candidates.slice(0, MAX_STORED_CANDIDATES).map((candidate) => ({
    agentId: candidate.agentId,
    provider: candidate.provider,
    model: candidate.model,
    eligible: candidate.eligible,
    score: candidate.score,
    rejections: candidate.rejections.slice(0, MAX_STORED_REASONS),
    notes: candidate.notes.slice(0, MAX_STORED_REASONS),
  }));

  const { data, error } = await client.rpc("record_resource_assignment", {
    p_project_id: input.projectId,
    p_node_id: input.nodeId,
    p_decision: assignment.decision,
    p_objective: assignment.objective,
    p_mode: assignment.mode,
    p_reason: assignment.reason,
    p_policy_version: assignment.policyVersion,
    p_agent_id: assignment.agentId,
    p_provider: assignment.provider,
    p_model: assignment.model,
    p_candidates: candidates,
    p_predicted_success_rate: assignment.prediction.evidenced
      ? assignment.prediction.expectedSuccessRate
      : null,
    p_prediction_evidenced: assignment.prediction.evidenced,
  });

  if (error) throw new Error(`the routing decision could not be recorded: ${error.message}`);
  if (typeof data !== "string") throw new Error("the routing decision could not be recorded");
  return data;
}
