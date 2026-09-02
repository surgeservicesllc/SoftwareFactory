import { z } from "zod";

import {
  CRM_TASK_COLUMNS,
  CRM_TASK_PRIORITIES,
  CRM_TASK_STATUSES,
  taskBucket,
  toSuggestionView,
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
 * Follow-ups: the open tasks, what the book suggests next, and who can own
 * either.
 *
 * The suggestions come from `crm_suggest_followups`, read live under the
 * caller's own RLS. Nothing on this route stores a suggestion, so nothing
 * can be stale: a paid invoice stops being suggested the moment it is paid.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    detail: z.string().trim().min(1).max(4000).nullish(),
    dueOn: z.string().regex(DATE, "A date, as YYYY-MM-DD."),
    priority: z.enum(CRM_TASK_PRIORITIES).default("normal"),
    assigneeEmployeeId: z.string().uuid().nullish(),
    accountId: z.string().uuid().nullish(),
    opportunityId: z.string().uuid().nullish(),
  })
  .strict();

const patchSchema = z
  .object({
    taskId: z.string().uuid(),
    status: z.enum(CRM_TASK_STATUSES).optional(),
    dueOn: z.string().regex(DATE, "A date, as YYYY-MM-DD.").optional(),
    priority: z.enum(CRM_TASK_PRIORITIES).optional(),
    assigneeEmployeeId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined
      || value.dueOn !== undefined
      || value.priority !== undefined
      || value.assigneeEmployeeId !== undefined,
    { message: "Nothing to change." },
  );

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const organizationId = activeOrganization.id;
    const today = isoDay(new Date());
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [openRead, recentRead, suggestRead, employeesRead] = await Promise.all([
      client
        .from("crm_tasks")
        .select(CRM_TASK_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .order("due_on", { ascending: true })
        .order("priority", { ascending: false })
        .limit(500),
      client
        .from("crm_tasks")
        .select(CRM_TASK_COLUMNS)
        .eq("organization_id", organizationId)
        .neq("status", "open")
        .gte("updated_at", weekAgo)
        .order("updated_at", { ascending: false })
        .limit(100),
      client.rpc("crm_suggest_followups", { p_organization: organizationId }),
      client
        .from("crm_employees")
        .select("id, first_name, last_name, role, active")
        .eq("organization_id", organizationId)
        .eq("active", true)
        .order("first_name", { ascending: true })
        .limit(500),
    ]);
    if (openRead.error) return databaseErrorResponse(openRead.error);
    if (recentRead.error) return databaseErrorResponse(recentRead.error);
    if (suggestRead.error) return databaseErrorResponse(suggestRead.error);
    if (employeesRead.error) return databaseErrorResponse(employeesRead.error);

    const open = ((openRead.data ?? []) as unknown as CrmTaskRow[]).map(toTaskView);
    const recent = ((recentRead.data ?? []) as unknown as CrmTaskRow[]).map(toTaskView);
    const suggestions = ((suggestRead.data ?? []) as unknown as CrmSuggestionRow[]).map(toSuggestionView);

    let overdue = 0;
    let dueToday = 0;
    for (const task of open) {
      const bucket = taskBucket(task, today);
      if (bucket === "overdue") overdue += 1;
      else if (bucket === "today") dueToday += 1;
    }

    return jsonNoStore({
      today,
      tasks: open,
      recent,
      suggestions,
      employees: ((employeesRead.data ?? []) as Array<{
        id: string; first_name: string; last_name: string | null; role: string;
      }>).map((employee) => ({
        id: employee.id,
        name: `${employee.first_name}${employee.last_name ? ` ${employee.last_name}` : ""}`,
        role: employee.role,
      })),
      counts: {
        open: open.length,
        overdue,
        dueToday,
        doneThisWeek: recent.filter((task) => task.status === "done").length,
        suggestions: suggestions.length,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_followups_unavailable", message: "Follow-ups could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_tasks")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId ?? null,
        opportunity_id: payload.opportunityId ?? null,
        assignee_employee_id: payload.assigneeEmployeeId ?? null,
        title: payload.title,
        detail: payload.detail ?? null,
        due_on: payload.dueOn,
        priority: payload.priority,
        status: "open",
        origin: "manual",
        created_by: user.id,
      })
      .select(CRM_TASK_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "reference_not_found", message: "That account, deal or person is not in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ task: toTaskView(data as unknown as CrmTaskRow) }, { status: 201 });
  } catch (error) {
    return failure(error, "invalid_task", "crm_task_not_recorded", "The follow-up could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    // The terminal moments are the row's own: the stamping trigger fills
    // done_at / cancelled_at from the status, so the caller sends only the
    // status and can never assert a moment.
    const changes: Record<string, unknown> = {};
    if (payload.status !== undefined) changes.status = payload.status;
    if (payload.dueOn !== undefined) changes.due_on = payload.dueOn;
    if (payload.priority !== undefined) changes.priority = payload.priority;
    if (payload.assigneeEmployeeId !== undefined) changes.assignee_employee_id = payload.assigneeEmployeeId;

    const { data, error } = await client
      .from("crm_tasks")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.taskId)
      .select(CRM_TASK_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "reference_not_found", message: "That person is not in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    if (!data) {
      return jsonNoStore(
        { error: { code: "task_not_found", message: "No such follow-up in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ task: toTaskView(data as unknown as CrmTaskRow) });
  } catch (error) {
    return failure(error, "invalid_task_change", "crm_task_not_updated", "The follow-up could not be updated.");
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
