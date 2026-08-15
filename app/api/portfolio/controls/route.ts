import { z } from "zod";

import {
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
  ApiRequestError,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The portfolio's owner controls, as explicit actions.
 *
 * This is goal 13 — "Global Bot Manager supports portfolio goals" — built the
 * way goal 14 demands: commands never guess. "Focus engineering on Project A"
 * is not parsed out of prose; it is `{action: "focus", projectIds: [a]}`, and
 * an ambiguous instruction is unrepresentable rather than misresolved.
 *
 * Authorization lives in the database functions, not here. Each one requires
 * an organization owner, writes an activity event, and touches nothing that is
 * already running. This route adds only shape validation and the same-origin
 * check; it grants nothing the caller's session does not already hold.
 */

const setPriority = z.object({
  action: z.literal("set_priority"),
  projectId: z.string().uuid(),
  // P0 is 0. The database constrains the range; mirrored here so a bad value
  // fails at the boundary with a message instead of a constraint error.
  priority: z.number().int().min(0).max(3),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

const setPause = z.object({
  action: z.literal("set_pause"),
  projectId: z.string().uuid(),
  paused: z.boolean(),
  // The database requires a reason to pause. Mirrored conditionally below.
  reason: z.string().trim().min(1).max(500).optional(),
}).strict().refine(
  (value) => !value.paused || value.reason !== undefined,
  { message: "A pause reason is required." },
);

const focus = z.object({
  action: z.literal("focus"),
  // Empty is meaningful: focus on nothing clears focus everywhere, which is
  // how "stop focusing" is said without a second verb.
  projectIds: z.array(z.string().uuid()).max(50),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

const setCapacity = z.object({
  action: z.literal("set_capacity"),
  maximumConcurrentRuns: z.number().int().min(0).max(500).nullable().optional(),
  emergencyReservedRuns: z.number().int().min(0).max(100).nullable().optional(),
  projectId: z.string().uuid().optional(),
  projectMaximumConcurrentRuns: z.number().int().min(0).max(500).nullable().optional(),
}).strict().refine(
  (value) =>
    value.maximumConcurrentRuns !== undefined
    || value.emergencyReservedRuns !== undefined
    || value.projectId !== undefined,
  { message: "At least one capacity limit must be supplied." },
);

const controlsRequestSchema = z.discriminatedUnion("action", [
  setPriority,
  setPause,
  focus,
  setCapacity,
]);

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { activeOrganization, client } = await requireActiveOrganization();
    const body = controlsRequestSchema.parse(
      await readBoundedJson(request, 16_384),
    );

    switch (body.action) {
      case "set_priority": {
        const { data, error } = await client.rpc("set_project_engineering_priority", {
          p_project_id: body.projectId,
          p_priority: body.priority,
          p_reason: body.reason ?? null,
        });
        if (error) return databaseErrorResponse(error);
        return jsonNoStore({ result: data });
      }
      case "set_pause": {
        const { data, error } = await client.rpc("set_project_engineering_pause", {
          p_project_id: body.projectId,
          p_paused: body.paused,
          p_reason: body.reason ?? null,
        });
        if (error) return databaseErrorResponse(error);
        return jsonNoStore({ result: data });
      }
      case "focus": {
        const { data, error } = await client.rpc("focus_portfolio_engineering", {
          p_organization_id: activeOrganization.id,
          p_project_ids: body.projectIds,
          p_reason: body.reason ?? null,
        });
        if (error) return databaseErrorResponse(error);
        return jsonNoStore({ result: data });
      }
      case "set_capacity": {
        const { data, error } = await client.rpc("set_portfolio_capacity_limits", {
          p_organization_id: activeOrganization.id,
          p_maximum_concurrent_runs: body.maximumConcurrentRuns ?? null,
          p_emergency_reserved_runs: body.emergencyReservedRuns ?? null,
          p_fairness_promotion_seconds: null,
          p_project_id: body.projectId ?? null,
          p_project_maximum_concurrent_runs: body.projectMaximumConcurrentRuns ?? null,
        });
        if (error) return databaseErrorResponse(error);
        return jsonNoStore({ result: data });
      }
    }
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_request", message: error.issues[0]?.message ?? "Invalid request." } },
        { status: 400 },
      );
    }
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "controls_unavailable", message: "The portfolio controls could not be applied." } },
      { status: 500 },
    );
  }
}
