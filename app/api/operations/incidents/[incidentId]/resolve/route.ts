import { z } from "zod";

import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const resolveSchema = z
  .object({
    rootCause: z.string().trim().min(10).max(4_000),
    correctiveAction: z.string().trim().min(10).max(4_000),
    validationId: z.string().uuid(),
    preventionReference: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

type IncidentRow = {
  id: string;
  status: string;
  sev: string | null;
  resolved_at: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  prevention_reference: string | null;
};

/**
 * Resolve an incident.
 *
 * The database refuses to resolve while production still fails its own
 * monitors, without a passing validation for the same project, or without a
 * recorded cause and corrective action — and requires prevention for SEV1/SEV2.
 * This route exists to carry the evidence, not to relax the gate.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ incidentId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { incidentId } = await params;
    if (!z.string().uuid().safeParse(incidentId).success) {
      return invalidRequest("The incident identifier is invalid.");
    }

    const parsed = resolveSchema.safeParse(await readBoundedJson(request, 16 * 1024));
    if (!parsed.success) {
      return invalidRequest(
        "Provide a root cause, a corrective action, and the passing validation that proves production recovered.",
      );
    }
    if (findSensitiveData(parsed.data)) {
      return invalidRequest("The resolution details appear to contain sensitive data.");
    }

    const context = await operationsContext();
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

    const { data, error } = await context.client
      .rpc("resolve_production_incident", {
        p_incident_id: incidentId,
        p_root_cause: parsed.data.rootCause,
        p_corrective_action: parsed.data.correctiveAction,
        p_validation_id: parsed.data.validationId,
        p_prevention_reference: parsed.data.preventionReference ?? null,
      })
      .single();

    if (error) return databaseErrorResponse(error);
    const incident = data as IncidentRow;

    return jsonNoStore({
      ...OPERATIONS_EXECUTION_ENVELOPE,
      incident: {
        id: incident.id,
        status: incident.status,
        severity: incident.sev,
        resolvedAt: incident.resolved_at,
        rootCause: incident.root_cause,
        correctiveAction: incident.corrective_action,
        preventionReference: incident.prevention_reference,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(error, "incident_resolution_failed", "The incident could not be resolved.");
  }
}
