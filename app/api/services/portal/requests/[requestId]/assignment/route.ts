import { z } from "zod";

import { toRequestSuggestionView, type CrmRequestSuggestionRow } from "@/lib/services/conversation-routing";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Who should take this request (ADR-240): the database's suggestion with
 * its reason, read live; and the assignment, which the database records
 * on the account's timeline by name. Null unassigns.
 */

const idSchema = z.string().uuid();
const assignSchema = z.object({ employeeId: z.string().uuid().nullable() }).strict();

type Context = { params: Promise<{ requestId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const parsed = idSchema.safeParse((await context.params).requestId);
    if (!parsed.success) return jsonNoStore({ error: { code: "portal_request_not_found", message: "No such request." } }, { status: 404 });
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("crm_request_suggested_assignee", { p_organization: activeOrganization.id, p_request: parsed.data });
    if (error) return databaseErrorResponse(error);
    const row = ((data ?? []) as unknown as CrmRequestSuggestionRow[])[0];
    if (!row) return jsonNoStore({ error: { code: "portal_request_not_found", message: "No such request in this workspace." } }, { status: 404 });
    return jsonNoStore({ suggestion: toRequestSuggestionView(row) });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "suggestion_unavailable", message: "The suggestion could not be read." } }, { status: 500 });
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertSameOriginRequest(request);
    const parsed = idSchema.safeParse((await context.params).requestId);
    if (!parsed.success) return jsonNoStore({ error: { code: "portal_request_not_found", message: "No such request." } }, { status: 404 });
    const payload = assignSchema.parse(await readBoundedJson(request, 1_000));
    const { activeOrganization, client } = await requireActiveOrganization();
    const { error } = await client.rpc("crm_request_assign", { p_organization: activeOrganization.id, p_request: parsed.data, p_employee: payload.employeeId });
    if (error) {
      if (error.code === "P0002" || /no such request/i.test(error.message ?? "")) {
        return jsonNoStore({ error: { code: "portal_request_not_found", message: "No such request in this workspace." } }, { status: 404 });
      }
      if (error.code === "23503" || /not an active member/i.test(error.message ?? "")) {
        return jsonNoStore({ error: { code: "assignee_refused", message: "That person is not an active member of staff in this workspace." } }, { status: 422 });
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ requestId: parsed.data, employeeId: payload.employeeId });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: { code: "invalid_assignment", message: error.issues[0]?.message ?? "Invalid assignment." } }, { status: 422 });
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "assignment_failed", message: "The request could not be assigned." } }, { status: 500 });
  }
}
