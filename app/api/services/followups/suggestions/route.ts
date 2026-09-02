import { z } from "zod";

import {
  CRM_SUGGESTION_KEY_PATTERN,
  CRM_TASK_COLUMNS,
  toTaskView,
  type CrmSuggestionRow,
  type CrmTaskRow,
} from "@/lib/services/followups";
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
 * Acting on a suggestion: accept it into a task, or decline it for a while.
 *
 * Accepting re-runs the rules and takes the suggestion's title and reason
 * from THAT result rather than from the request body, so a task can only
 * ever claim a reason the database actually computed. A key that no longer
 * fires — the invoice was paid between render and click — is a 409, which
 * is the honest answer: there is nothing left to follow up.
 */

const acceptSchema = z
  .object({
    suggestionKey: z.string().regex(CRM_SUGGESTION_KEY_PATTERN, "Not a suggestion key."),
    assigneeEmployeeId: z.string().uuid().nullish(),
  })
  .strict();

const dismissSchema = z
  .object({
    suggestionKey: z.string().regex(CRM_SUGGESTION_KEY_PATTERN, "Not a suggestion key."),
    days: z.number().int().min(1).max(365).default(30),
    note: z.string().trim().min(1).max(300).nullish(),
  })
  .strict();

const undismissSchema = z
  .object({ suggestionKey: z.string().regex(CRM_SUGGESTION_KEY_PATTERN, "Not a suggestion key.") })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = acceptSchema.parse(await readBoundedJson(request, 8_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();
    const organizationId = activeOrganization.id;

    const suggested = await client.rpc("crm_suggest_followups", { p_organization: organizationId });
    if (suggested.error) return databaseErrorResponse(suggested.error);
    const match = ((suggested.data ?? []) as unknown as CrmSuggestionRow[]).find(
      (row) => row.suggestion_key === payload.suggestionKey,
    );
    if (!match) {
      return jsonNoStore(
        {
          error: {
            code: "suggestion_gone",
            message: "That suggestion no longer applies — the fact behind it has changed, or it was already accepted.",
          },
        },
        { status: 409 },
      );
    }

    const { data, error } = await client
      .from("crm_tasks")
      .insert({
        organization_id: organizationId,
        account_id: match.account_id,
        opportunity_id: match.opportunity_id,
        assignee_employee_id: payload.assigneeEmployeeId ?? null,
        title: match.title,
        due_on: match.due_on,
        priority: match.priority,
        status: "open",
        origin: "suggested",
        suggestion_key: match.suggestion_key,
        reason: match.reason,
        created_by: user.id,
      })
      .select(CRM_TASK_COLUMNS)
      .single();
    if (error) {
      // Two tabs accepted the same suggestion; the index kept one.
      if (error.code === "23505") {
        return jsonNoStore(
          { error: { code: "suggestion_already_accepted", message: "Somebody already accepted that suggestion." } },
          { status: 409 },
        );
      }
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "reference_not_found", message: "That person is not in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ task: toTaskView(data as unknown as CrmTaskRow) }, { status: 201 });
  } catch (error) {
    return failure(error, "invalid_acceptance", "crm_suggestion_not_accepted", "The suggestion could not be accepted.");
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = dismissSchema.parse(await readBoundedJson(request, 8_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const until = new Date(Date.now() + payload.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await client
      .from("crm_followup_dismissals")
      .upsert(
        {
          organization_id: activeOrganization.id,
          suggestion_key: payload.suggestionKey,
          until_on: until,
          note: payload.note ?? null,
          created_by: user.id,
        },
        { onConflict: "organization_id,suggestion_key" },
      )
      .select("suggestion_key, until_on")
      .single();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ dismissed: { suggestionKey: data.suggestion_key, untilOn: data.until_on } });
  } catch (error) {
    return failure(error, "invalid_dismissal", "crm_suggestion_not_dismissed", "The suggestion could not be dismissed.");
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = undismissSchema.parse(await readBoundedJson(request, 8_000));
    const { client, activeOrganization } = await requireActiveOrganization();
    const { error } = await client
      .from("crm_followup_dismissals")
      .delete()
      .eq("organization_id", activeOrganization.id)
      .eq("suggestion_key", payload.suggestionKey);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ undismissed: payload.suggestionKey });
  } catch (error) {
    return failure(error, "invalid_dismissal", "crm_suggestion_not_restored", "The suggestion could not be restored.");
  }
}

function failure(error: unknown, invalidCode: string, failureCode: string, message: string) {
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof z.ZodError) {
    return jsonNoStore(
      { error: { code: invalidCode, message: error.issues[0]?.message ?? message } },
      { status: 422 },
    );
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code: failureCode, message } }, { status: 500 });
}
