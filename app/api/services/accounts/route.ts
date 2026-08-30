import { z } from "zod";

import {
  CRM_ACCOUNT_COLUMNS,
  CRM_ACCOUNT_KINDS,
  CRM_ACCOUNT_STATUSES,
  toAccountView,
  type CrmAccountRow,
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
 * The book of business: list and create CRM accounts.
 *
 * Organization-scoped through RLS and the explicit organization filter —
 * the policy is the guarantee, the filter is how a row satisfies it. The
 * list carries live counts by status and kind so the Services dashboard's
 * stat cards are counted from the same read the table renders, never a
 * second number that can drift from the first.
 */

const listQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    status: z.enum(CRM_ACCOUNT_STATUSES).optional(),
    kind: z.enum(CRM_ACCOUNT_KINDS).optional(),
  })
  .strict();

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(CRM_ACCOUNT_KINDS),
    status: z.enum(CRM_ACCOUNT_STATUSES).default("lead"),
    email: z.string().trim().email().max(320).nullish(),
    phone: z.string().trim().regex(/^[0-9+() .\-]{7,32}$/, "A phone number, digits and separators only.").nullish(),
    source: z.string().trim().min(1).max(120).nullish(),
    billingAddress: z.string().trim().min(1).max(500).nullish(),
    notes: z.string().trim().min(1).max(4000).nullish(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      kind: url.searchParams.get("kind") ?? undefined,
    });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_accounts_query", message: "The account list query is invalid." } },
        { status: 400 },
      );
    }

    const { client, activeOrganization } = await requireActiveOrganization();

    let query = client
      .from("crm_accounts")
      .select(CRM_ACCOUNT_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (parsed.data.status) query = query.eq("status", parsed.data.status);
    if (parsed.data.kind) query = query.eq("kind", parsed.data.kind);
    if (parsed.data.q) {
      // ilike over an escaped needle; % and _ in the person's text are
      // literals to them, so they are literals to the filter too.
      const needle = parsed.data.q.replace(/[%_\\]/g, (ch) => `\\${ch}`);
      query = query.ilike("name", `%${needle}%`);
    }
    const { data, error } = await query;
    if (error) return databaseErrorResponse(error);

    /*
     * Counts over the whole book, not the filtered page: the dashboard's
     * "12 leads, 84 customers" must state the organization's truth even
     * while the table is narrowed to one slice of it.
     */
    const counted = await client
      .from("crm_accounts")
      .select("status, kind")
      .eq("organization_id", activeOrganization.id)
      .limit(10_000);
    if (counted.error) return databaseErrorResponse(counted.error);
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const row of (counted.data ?? []) as { status: string; kind: string }[]) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
    }

    return jsonNoStore({
      accounts: ((data ?? []) as unknown as CrmAccountRow[]).map(toAccountView),
      counts: { byStatus, byKind, total: (counted.data ?? []).length },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_accounts_unavailable", message: "Accounts could not be listed." } },
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
      .from("crm_accounts")
      .insert({
        organization_id: activeOrganization.id,
        name: payload.name,
        kind: payload.kind,
        status: payload.status,
        email: payload.email ?? null,
        phone: payload.phone ?? null,
        source: payload.source ?? null,
        billing_address: payload.billingAddress ?? null,
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_ACCOUNT_COLUMNS)
      .single();
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({ account: toAccountView(data as unknown as CrmAccountRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_account",
            message: error.issues[0]?.message ?? "The account could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_account_not_recorded", message: "The account could not be recorded." } },
      { status: 500 },
    );
  }
}
