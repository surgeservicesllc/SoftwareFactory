import { z } from "zod";

import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
  requireOwner,
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

/**
 * Owner emergency controls.
 *
 * Freezing subtracts authority, so an owner or administrator may do it.
 * Resuming and stopping all autonomous operations change what the platform is
 * permitted to do, so both are owner-only, both require a written reason, and
 * both are recorded as immutable audit evidence.
 */
const controlSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("freeze"),
    projectId: z.string().uuid(),
    reason: z.string().trim().min(10).max(500),
  }).strict(),
  z.object({
    action: z.literal("resume"),
    projectId: z.string().uuid(),
    note: z.string().trim().min(10).max(500),
    acknowledgeOpenIncidents: z.boolean().default(false),
  }).strict(),
  z.object({
    action: z.literal("stop"),
    reason: z.string().trim().min(10).max(500),
  }).strict(),
  z.object({
    action: z.literal("resume_operations"),
    note: z.string().trim().min(10).max(500),
  }).strict(),
]);

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = controlSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return invalidRequest(
        "Choose freeze, resume, or stop, and include a reason of at least 10 characters.",
      );
    }
    if (findSensitiveData(parsed.data)) {
      return invalidRequest("The reason appears to contain sensitive data.");
    }

    const context = await operationsContext();
    const forbidden = parsed.data.action === "freeze"
      ? requireManager(context)
      : requireOwner(context);
    if (forbidden) return forbidden;

    if (parsed.data.action === "freeze") {
      const { data, error } = await context.client.rpc("freeze_project_releases", {
        p_project_id: parsed.data.projectId,
        p_reason_code: "OWNER_REQUESTED_FREEZE",
        p_reason: parsed.data.reason,
        p_incident_id: null,
        p_automatic: false,
      });
      if (error) return databaseErrorResponse(error);
      return jsonNoStore({
        ...OPERATIONS_EXECUTION_ENVELOPE,
        action: "freeze",
        changed: data === true,
        releasesFrozen: true,
      });
    }

    if (parsed.data.action === "resume") {
      const { data, error } = await context.client.rpc("resume_project_releases", {
        p_project_id: parsed.data.projectId,
        p_note: parsed.data.note,
        p_acknowledge_open_incidents: parsed.data.acknowledgeOpenIncidents,
      });
      if (error) return databaseErrorResponse(error);
      return jsonNoStore({
        ...OPERATIONS_EXECUTION_ENVELOPE,
        action: "resume",
        changed: data === true,
        releasesFrozen: data !== true,
      });
    }

    if (parsed.data.action === "resume_operations") {
      // Reversing the emergency stop never lifts a per-project release freeze;
      // each one is released on its own evidence.
      const { data, error } = await context.client.rpc("resume_autonomous_operations", {
        p_organization_id: context.activeOrganization.id,
        p_note: parsed.data.note,
      });
      if (error) return databaseErrorResponse(error);

      return jsonNoStore({
        ...OPERATIONS_EXECUTION_ENVELOPE,
        action: "resume_operations",
        projectsResumed: typeof data === "number" ? data : 0,
        releaseFreezesLifted: 0,
      });
    }

    const { data, error } = await context.client.rpc("stop_autonomous_operations", {
      p_organization_id: context.activeOrganization.id,
      p_reason: parsed.data.reason,
    });
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      ...OPERATIONS_EXECUTION_ENVELOPE,
      action: "stop",
      projectsStopped: typeof data === "number" ? data : 0,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(error, "operations_control_failed", "The control could not be applied.");
  }
}
