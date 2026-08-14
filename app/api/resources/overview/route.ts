import { BREAKER_FAULT_EXPLANATIONS, COOLDOWN_MS, type BreakerFault } from "@/lib/resources/breakers";
import { WORK_CAPABILITIES } from "@/lib/resources/capabilities";
import { RESOURCE_POLICY_VERSION } from "@/lib/resources/manager";
import { operationsContext, operationsFailure } from "@/lib/operations/route";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * What the Resource Manager currently knows.
 *
 * Everything returned here is either a declaration (the capability vocabulary,
 * the policy version) or an observation someone recorded. Nothing is derived
 * from an unmeasured guess, and an absent value stays absent rather than
 * becoming a zero — a provider with no recorded faults is not a provider proven
 * healthy, and the response says which of the two it is.
 *
 * Read-only, member-scoped. RLS does the real filtering; the organization
 * predicate here narrows the query rather than granting anything.
 */

type BreakerRow = {
  target: string;
  state: "closed" | "open" | "half_open";
  fault: BreakerFault | null;
  consecutive_faults: number;
  opened_at: string | null;
  reason: string | null;
  updated_at: string;
};

type AssignmentRow = {
  id: string;
  project_id: string;
  node_id: string;
  decision: string;
  objective: string;
  mode: string;
  agent_id: string | null;
  provider: string | null;
  model: string | null;
  reason: string;
  policy_version: string;
  candidates: unknown;
  predicted_success_rate: string | number | null;
  prediction_evidenced: boolean;
  decided_at: string;
};

type TransitionRow = {
  target: string;
  from_state: string;
  to_state: string;
  fault: string | null;
  reason: string | null;
  occurred_at: string;
};

const RECENT_ASSIGNMENT_LIMIT = 25;
const RECENT_TRANSITION_LIMIT = 25;

export async function GET() {
  try {
    const context = await operationsContext();
    const organizationId = context.activeOrganization.id;

    const [breakers, assignments, transitions] = await Promise.all([
      context.client
        .from("resource_breakers")
        .select("target,state,fault,consecutive_faults,opened_at,reason,updated_at")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false }),
      context.client
        .from("resource_assignments")
        .select(
          "id,project_id,node_id,decision,objective,mode,agent_id,provider,model,reason,policy_version,candidates,predicted_success_rate,prediction_evidenced,decided_at",
        )
        .eq("organization_id", organizationId)
        .order("decided_at", { ascending: false })
        .limit(RECENT_ASSIGNMENT_LIMIT),
      context.client
        .from("resource_breaker_events")
        .select("target,from_state,to_state,fault,reason,occurred_at")
        .eq("organization_id", organizationId)
        .order("occurred_at", { ascending: false })
        .limit(RECENT_TRANSITION_LIMIT),
    ]);

    if (breakers.error) return databaseErrorResponse(breakers.error);
    if (assignments.error) return databaseErrorResponse(assignments.error);
    if (transitions.error) return databaseErrorResponse(transitions.error);

    const breakerRows = (breakers.data ?? []) as BreakerRow[];
    const assignmentRows = (assignments.data ?? []) as AssignmentRow[];
    const transitionRows = (transitions.data ?? []) as TransitionRow[];

    return jsonNoStore({
      policyVersion: RESOURCE_POLICY_VERSION,
      capabilities: WORK_CAPABILITIES,

      // Routing has never run against real work, and saying so is the point:
      // an empty console must read as "nothing has happened here", not as a
      // healthy system with nothing to report.
      executionState: "not_connected",
      executionLabel: "Not Connected",
      executionReason:
        "No provider run has executed, so no routing decision has ever been recorded against real work.",

      breakers: breakerRows.map((row) => ({
        target: row.target,
        state: row.state,
        fault: row.fault,
        faultExplanation: row.fault ? BREAKER_FAULT_EXPLANATIONS[row.fault] : null,
        consecutiveFaults: row.consecutive_faults,
        openedAt: row.opened_at,
        cooldownMs: row.fault ? COOLDOWN_MS[row.fault] : null,
        reason: row.reason,
        updatedAt: row.updated_at,
      })),

      transitions: transitionRows.map((row) => ({
        target: row.target,
        fromState: row.from_state,
        toState: row.to_state,
        fault: row.fault,
        reason: row.reason,
        occurredAt: row.occurred_at,
      })),

      assignments: assignmentRows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        nodeId: row.node_id,
        decision: row.decision,
        objective: row.objective,
        mode: row.mode,
        agentId: row.agent_id,
        provider: row.provider,
        model: row.model,
        reason: row.reason,
        policyVersion: row.policy_version,
        candidates: Array.isArray(row.candidates) ? row.candidates : [],
        // An unevidenced prediction has no rate to report. Sending 0 would be a
        // measurement nobody made.
        predictedSuccessRate: row.prediction_evidenced && row.predicted_success_rate !== null
          ? Number(row.predicted_success_rate)
          : null,
        predictionEvidenced: row.prediction_evidenced,
        decidedAt: row.decided_at,
      })),
    });
  } catch (error) {
    return operationsFailure(
      error,
      "resource_overview_failed",
      "The resource manager state could not be read.",
    );
  }
}
