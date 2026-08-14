import { isOperationsEventType, plannedActions } from "@/lib/operations/events";
import {
  OPERATIONS_EXECUTION_ENVELOPE,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import { ApiRequestError, databaseErrorResponse, jsonNoStore, requestErrorResponse } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

type EventRow = {
  id: string;
  project_id: string;
  event_type: string;
  dedupe_key: string;
  state: string;
  attempts: number;
  max_attempts: number;
  processed_at: string | null;
  last_error: string | null;
  created_at: string;
};

export async function GET() {
  try {
    const context = await operationsContext();
    const { data, error } = await context.client
      .from("operations_events")
      .select("id,project_id,event_type,dedupe_key,state,attempts,max_attempts,processed_at,last_error,created_at")
      .eq("organization_id", context.activeOrganization.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      ...OPERATIONS_EXECUTION_ENVELOPE,
      events: ((data ?? []) as EventRow[]).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        eventType: row.event_type,
        dedupeKey: row.dedupe_key,
        state: row.state,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        processedAt: row.processed_at,
        lastError: row.last_error,
        createdAt: row.created_at,
        plannedActions: isOperationsEventType(row.event_type) ? plannedActions(row.event_type) : [],
      })),
    });
  } catch (error) {
    return operationsFailure(error, "operations_events_unavailable", "Operations events could not be loaded.");
  }
}

/**
 * Process one pending event.
 *
 * Claim, act, complete. The claim is a `for update skip locked` selection and
 * completion is idempotent, so a duplicate request never double-processes and
 * a crashed processor leaves the event recoverable rather than lost.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const context = await operationsContext();
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

    const { data: claimData, error: claimError } = await context.client
      .rpc("claim_operations_event", { p_organization_id: context.activeOrganization.id });
    if (claimError) return databaseErrorResponse(claimError);

    const claimed = ((claimData ?? []) as EventRow[])[0] ?? null;
    if (!claimed) {
      return jsonNoStore({ ...OPERATIONS_EXECUTION_ENVELOPE, processed: null, pending: 0 });
    }

    const actions = isOperationsEventType(claimed.event_type) ? plannedActions(claimed.event_type) : [];
    let handlerError: string | null = null;

    // The one action this phase can genuinely perform for every event type is
    // recomputing health from current real signals.
    const { error: healthError } = await context.client
      .rpc("evaluate_project_health", { p_project_id: claimed.project_id });
    if (healthError) handlerError = "Project health could not be recomputed.";

    const { data: completedData, error: completeError } = await context.client
      .rpc("complete_operations_event", {
        p_event_id: claimed.id,
        p_succeeded: handlerError === null,
        p_error: handlerError,
      });
    if (completeError) return databaseErrorResponse(completeError);

    const completed = ((completedData ?? []) as EventRow[])[0] ?? null;

    return jsonNoStore({
      ...OPERATIONS_EXECUTION_ENVELOPE,
      processed: completed
        ? {
          id: completed.id,
          eventType: completed.event_type,
          state: completed.state,
          attempts: completed.attempts,
          processedAt: completed.processed_at,
          lastError: completed.last_error,
        }
        : null,
      actions,
      deferredActions: actions.filter((action) => !action.implemented),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(error, "operations_event_processing_failed", "The event could not be processed.");
  }
}
