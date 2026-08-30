import { z } from "zod";

import {
  CRM_EMPLOYEE_CODE_PATTERN,
  CRM_EMPLOYEE_COLUMNS,
  CRM_EMPLOYEE_ROLES,
  toEmployeeView,
  type CrmEmployeeRow,
} from "@/lib/services/crm";
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
 * The org chart: owners, branch and sales managers, sales reps, customer
 * service, dispatch and admin.
 *
 * A staff record is a person in the business, not a login — most of them
 * will never sign in, and the optional link to an account is reported as a
 * fact rather than exposed as an identity. There is no DELETE: commissions,
 * assignments and signatures hang off a person, so someone who leaves is
 * ended, never erased.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    employeeCode: z
      .string()
      .trim()
      .regex(CRM_EMPLOYEE_CODE_PATTERN, "A short code: letters, digits and dashes."),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80).nullish(),
    email: z.string().trim().email().max(320).nullish(),
    phone: z.string().trim().min(7).max(32).nullish(),
    role: z.enum(CRM_EMPLOYEE_ROLES),
    title: z.string().trim().min(1).max(120).nullish(),
    branchId: z.string().uuid().nullish(),
    reportsToId: z.string().uuid().nullish(),
    hireDate: z.string().regex(DATE, "A date, as YYYY-MM-DD.").nullish(),
    commissionBps: z.number().int().min(0).max(10_000).nullish(),
    monthlyQuotaCents: z.number().int().min(0).max(100_000_000_000).nullish(),
    notes: z.string().trim().min(1).max(4000).nullish(),
  })
  .strict();

const patchSchema = z
  .object({
    employeeId: z.string().uuid(),
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: z.string().trim().min(7).max(32).nullable().optional(),
    role: z.enum(CRM_EMPLOYEE_ROLES).optional(),
    title: z.string().trim().min(1).max(120).nullable().optional(),
    branchId: z.string().uuid().nullable().optional(),
    reportsToId: z.string().uuid().nullable().optional(),
    commissionBps: z.number().int().min(0).max(10_000).nullable().optional(),
    monthlyQuotaCents: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
    notes: z.string().trim().min(1).max(4000).nullable().optional(),
    /** Ending someone's employment takes them off the active roster. */
    endDate: z.string().regex(DATE, "A date, as YYYY-MM-DD.").nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_employees")
      .select(CRM_EMPLOYEE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("active", { ascending: false })
      .order("last_name", { ascending: true, nullsFirst: false })
      .limit(600);
    if (error) return databaseErrorResponse(error);

    const employees = ((data ?? []) as unknown as CrmEmployeeRow[]).map(toEmployeeView);
    const byRole: Record<string, number> = {};
    for (const employee of employees) {
      if (!employee.active) continue;
      byRole[employee.role] = (byRole[employee.role] ?? 0) + 1;
    }
    return jsonNoStore({
      employees,
      counts: {
        total: employees.length,
        active: employees.filter((employee) => employee.active).length,
        byRole,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_employees_unavailable", message: "The team could not be listed." } },
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
      .from("crm_employees")
      .insert({
        organization_id: activeOrganization.id,
        employee_code: payload.employeeCode,
        first_name: payload.firstName,
        last_name: payload.lastName ?? null,
        email: payload.email ?? null,
        phone: payload.phone ?? null,
        role: payload.role,
        title: payload.title ?? null,
        branch_id: payload.branchId ?? null,
        reports_to_id: payload.reportsToId ?? null,
        hire_date: payload.hireDate ?? null,
        commission_bps: payload.commissionBps ?? null,
        monthly_quota_cents: payload.monthlyQuotaCents ?? null,
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_EMPLOYEE_COLUMNS)
      .single();
    if (error) return employeeWriteError(error);
    return jsonNoStore({ employee: toEmployeeView(data as unknown as CrmEmployeeRow) }, { status: 201 });
  } catch (error) {
    return failure(error, "invalid_employee", "crm_employee_not_recorded", "The team member could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    // Nobody reports to themselves. The schema refuses it too; refusing it
    // here names the mistake instead of surfacing a constraint.
    if (payload.reportsToId === payload.employeeId) {
      return jsonNoStore(
        {
          error: {
            code: "self_report",
            message: "A person cannot report to themselves.",
          },
        },
        { status: 422 },
      );
    }

    const changes: Record<string, unknown> = {};
    if (payload.firstName !== undefined) changes.first_name = payload.firstName;
    if (payload.lastName !== undefined) changes.last_name = payload.lastName;
    if (payload.email !== undefined) changes.email = payload.email;
    if (payload.phone !== undefined) changes.phone = payload.phone;
    if (payload.role !== undefined) changes.role = payload.role;
    if (payload.title !== undefined) changes.title = payload.title;
    if (payload.branchId !== undefined) changes.branch_id = payload.branchId;
    if (payload.reportsToId !== undefined) changes.reports_to_id = payload.reportsToId;
    if (payload.commissionBps !== undefined) changes.commission_bps = payload.commissionBps;
    if (payload.monthlyQuotaCents !== undefined) changes.monthly_quota_cents = payload.monthlyQuotaCents;
    if (payload.notes !== undefined) changes.notes = payload.notes;
    if (payload.active !== undefined) changes.active = payload.active;
    if (payload.endDate !== undefined) {
      changes.end_date = payload.endDate;
      if (payload.endDate !== null) changes.active = false;
    }

    const { data, error } = await client
      .from("crm_employees")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.employeeId)
      .select(CRM_EMPLOYEE_COLUMNS)
      .maybeSingle();
    if (error) return employeeWriteError(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "employee_not_found", message: "No such team member in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ employee: toEmployeeView(data as unknown as CrmEmployeeRow) });
  } catch (error) {
    return failure(error, "invalid_employee_change", "crm_employee_not_updated", "The team member could not be updated.");
  }
}

function employeeWriteError(error: { code?: string }) {
  if (error.code === "23505") {
    return jsonNoStore(
      {
        error: {
          code: "employee_code_taken",
          message: "That employee code is already in use in this workspace.",
        },
      },
      { status: 409 },
    );
  }
  if (error.code === "23503") {
    return jsonNoStore(
      {
        error: {
          code: "reference_not_found",
          message: "That branch or supervisor is not in this workspace.",
        },
      },
      { status: 404 },
    );
  }
  if (error.code === "23514") {
    return jsonNoStore(
      {
        error: {
          code: "employee_refused",
          message:
            "The record was refused — employment cannot end before it began, an ended employee cannot stay active, and nobody reports to themselves.",
        },
      },
      { status: 409 },
    );
  }
  return databaseErrorResponse(error as Parameters<typeof databaseErrorResponse>[0]);
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
