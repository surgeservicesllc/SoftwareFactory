import { z } from "zod";

import {
  CRM_BRANCH_COLUMNS,
  CRM_CODE_PATTERN,
  CRM_TIME_ZONE_PATTERN,
  toBranchView,
  type CrmBranchRow,
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
 * Branches: the physical operation a book of business is run out of.
 *
 * The list rides with the counts a branch manager actually opens the page
 * for — accounts served, staff on the roster, technicians in the field —
 * read from the same authority as the rows themselves rather than
 * estimated. There is no DELETE: a branch that closes is closed, and its
 * history stays attached to it.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    code: z.string().trim().regex(CRM_CODE_PATTERN, "A short code: letters, digits and dashes."),
    name: z.string().trim().min(1).max(160),
    address: z.string().trim().min(1).max(500).nullish(),
    phone: z.string().trim().min(7).max(32).nullish(),
    email: z.string().trim().email().max(320).nullish(),
    timeZone: z.string().trim().regex(CRM_TIME_ZONE_PATTERN, "An IANA zone, like America/Denver.").nullish(),
    openedOn: z.string().regex(DATE, "A date, as YYYY-MM-DD.").nullish(),
    managerId: z.string().uuid().nullish(),
    notes: z.string().trim().min(1).max(4000).nullish(),
  })
  .strict();

const patchSchema = z
  .object({
    branchId: z.string().uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    phone: z.string().trim().min(7).max(32).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    timeZone: z.string().trim().regex(CRM_TIME_ZONE_PATTERN).nullable().optional(),
    managerId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().min(1).max(4000).nullable().optional(),
    /** Closing a branch deactivates it; the schema will not hold one open. */
    closedOn: z.string().regex(DATE, "A date, as YYYY-MM-DD.").nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_branches")
      .select(CRM_BRANCH_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(400);
    if (error) return databaseErrorResponse(error);

    const branches = ((data ?? []) as unknown as CrmBranchRow[]).map(toBranchView);

    // The three counts a branch page is opened for, tallied from the rows
    // themselves so the header can never disagree with the tables below it.
    const [accounts, employees, technicians] = await Promise.all([
      client.from("crm_accounts").select("branch_id").eq("organization_id", activeOrganization.id).limit(5000),
      client.from("crm_employees").select("branch_id, active").eq("organization_id", activeOrganization.id).limit(5000),
      client.from("crm_technicians").select("branch_id, active").eq("organization_id", activeOrganization.id).limit(5000),
    ]);
    if (accounts.error) return databaseErrorResponse(accounts.error);
    if (employees.error) return databaseErrorResponse(employees.error);
    if (technicians.error) return databaseErrorResponse(technicians.error);

    const tally = (rows: { branch_id: string | null }[]) => {
      const counts: Record<string, number> = {};
      for (const row of rows) {
        if (row.branch_id === null) continue;
        counts[row.branch_id] = (counts[row.branch_id] ?? 0) + 1;
      }
      return counts;
    };
    const accountCounts = tally((accounts.data ?? []) as { branch_id: string | null }[]);
    const staffCounts = tally(
      ((employees.data ?? []) as { branch_id: string | null; active: boolean }[]).filter((row) => row.active),
    );
    const technicianCounts = tally(
      ((technicians.data ?? []) as { branch_id: string | null; active: boolean }[]).filter((row) => row.active),
    );

    return jsonNoStore({
      branches: branches.map((branch) => ({
        ...branch,
        accountCount: accountCounts[branch.id] ?? 0,
        staffCount: staffCounts[branch.id] ?? 0,
        technicianCount: technicianCounts[branch.id] ?? 0,
      })),
      counts: {
        total: branches.length,
        active: branches.filter((branch) => branch.active).length,
        // Accounts no branch serves yet: the number that says how much of
        // the book is still unassigned, rather than hiding it.
        unassignedAccounts:
          ((accounts.data ?? []) as { branch_id: string | null }[]).filter((row) => row.branch_id === null).length,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_branches_unavailable", message: "Branches could not be listed." } },
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
      .from("crm_branches")
      .insert({
        organization_id: activeOrganization.id,
        code: payload.code,
        name: payload.name,
        address: payload.address ?? null,
        phone: payload.phone ?? null,
        email: payload.email ?? null,
        time_zone: payload.timeZone ?? null,
        opened_on: payload.openedOn ?? null,
        manager_id: payload.managerId ?? null,
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_BRANCH_COLUMNS)
      .single();
    if (error) return branchWriteError(error);
    return jsonNoStore({ branch: toBranchView(data as unknown as CrmBranchRow) }, { status: 201 });
  } catch (error) {
    return failure(error, "invalid_branch", "crm_branch_not_recorded", "The branch could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.address !== undefined) changes.address = payload.address;
    if (payload.phone !== undefined) changes.phone = payload.phone;
    if (payload.email !== undefined) changes.email = payload.email;
    if (payload.timeZone !== undefined) changes.time_zone = payload.timeZone;
    if (payload.managerId !== undefined) changes.manager_id = payload.managerId;
    if (payload.notes !== undefined) changes.notes = payload.notes;
    if (payload.active !== undefined) changes.active = payload.active;
    if (payload.closedOn !== undefined) {
      changes.closed_on = payload.closedOn;
      // Closing a branch closes it. The schema refuses a closed branch that
      // is still marked active, so this is stated rather than left to the
      // caller to remember.
      if (payload.closedOn !== null) changes.active = false;
    }

    const { data, error } = await client
      .from("crm_branches")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.branchId)
      .select(CRM_BRANCH_COLUMNS)
      .maybeSingle();
    if (error) return branchWriteError(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "branch_not_found", message: "No such branch in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ branch: toBranchView(data as unknown as CrmBranchRow) });
  } catch (error) {
    return failure(error, "invalid_branch_change", "crm_branch_not_updated", "The branch could not be updated.");
  }
}

function branchWriteError(error: { code?: string }) {
  if (error.code === "23505") {
    return jsonNoStore(
      {
        error: {
          code: "branch_code_taken",
          message: "That branch code is already in use in this workspace.",
        },
      },
      { status: 409 },
    );
  }
  if (error.code === "23503") {
    return jsonNoStore(
      { error: { code: "reference_not_found", message: "That manager is not in this workspace." } },
      { status: 404 },
    );
  }
  if (error.code === "23514") {
    return jsonNoStore(
      {
        error: {
          code: "branch_refused",
          message:
            "The record was refused — a branch cannot close before it opened, and a closed branch cannot stay active.",
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
