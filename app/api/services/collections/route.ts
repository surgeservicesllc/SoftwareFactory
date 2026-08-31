import { z } from "zod";

import {
  CRM_DUNNING_ACTIONS,
  CRM_DUNNING_NOTICE_COLUMNS,
  toCollectionsView,
  toDunningNoticeView,
  type CrmCollectionsRow,
  type CrmDunningNoticeRow,
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
 * The collections worklist, and the record of what was done about it.
 *
 * A notice here says what a PERSON did — called, posted a letter, agreed a
 * plan. Nothing is sent from this route, because no email or SMS provider
 * is connected; a queue of unsent reminders that rendered like sent ones
 * would be worse than no dunning at all, so the surface records rather
 * than pretends.
 */

const noticeSchema = z
  .object({
    invoiceId: z.string().uuid(),
    accountId: z.string().uuid(),
    action: z.enum(CRM_DUNNING_ACTIONS as unknown as [string, ...string[]]),
    daysOverdue: z.number().int().min(0).max(36_500),
    balanceCents: z.number().int().min(0),
    outcome: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const raw = Number(new URL(request.url).searchParams.get("minDays"));
    const minDays = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 3650) : 1;

    const [worklist, notices] = await Promise.all([
      client.rpc("crm_collections_worklist", { p_min_days: minDays }),
      client
        .from("crm_dunning_notices")
        .select(CRM_DUNNING_NOTICE_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("acted_at", { ascending: false })
        .limit(300),
    ]);
    if (worklist.error) return databaseErrorResponse(worklist.error);
    if (notices.error) return databaseErrorResponse(notices.error);

    const invoices = ((worklist.data ?? []) as CrmCollectionsRow[]).map(toCollectionsView);

    return jsonNoStore({
      minDays,
      invoices,
      notices: ((notices.data ?? []) as unknown as CrmDunningNoticeRow[]).map(toDunningNoticeView),
      counts: {
        total: invoices.length,
        balanceCents: invoices.reduce((sum, invoice) => sum + invoice.balanceCents, 0),
        /*
         * Overdue invoices nobody has touched. This is the number the
         * worklist exists for — a long list somebody is working and a long
         * list nobody has opened look identical without it.
         */
        untouched: invoices.filter((invoice) => invoice.untouched).length,
        over90: invoices.filter((invoice) => invoice.bucket === "90+").length,
      },
      delivery: { available: false, label: "Not Connected" },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_collections_unavailable", message: "Collections could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = noticeSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_dunning_notices")
      .insert({
        organization_id: activeOrganization.id,
        invoice_id: payload.invoiceId,
        account_id: payload.accountId,
        action: payload.action,
        days_overdue: payload.daysOverdue,
        balance_cents: payload.balanceCents,
        outcome: payload.outcome ?? null,
        created_by: user.id,
      })
      .select(CRM_DUNNING_NOTICE_COLUMNS)
      .single();
    if (error) {
      // The database refuses a notice whose invoice belongs to a different
      // account by name. That refusal is the answer, not a 500.
      if (error.code === "23514" || /not on this account/i.test(error.message ?? "")) {
        return jsonNoStore(
          {
            error: {
              code: "invoice_not_on_account",
              message: "That invoice is not on this account.",
            },
          },
          { status: 409 },
        );
      }
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "reference_not_found", message: "That invoice is not in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }

    return jsonNoStore(
      { notice: toDunningNoticeView(data as unknown as CrmDunningNoticeRow) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_dunning_notice",
            message: error.issues[0]?.message ?? "The note could not be recorded.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_dunning_notice_not_recorded", message: "The note could not be recorded." } },
      { status: 500 },
    );
  }
}
