import { z } from "zod";

import {
  CRM_BILLING_RUN_COLUMNS,
  toBillingRunView,
  type CrmBillingRunRow,
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
 * Billing runs: invoices raised from recurring service plans.
 *
 * The route does not decide what to bill and does not check first. It calls
 * `crm_generate_due_invoices`, which is idempotent because a partial unique
 * index says a plan cannot be billed twice for the same period — not
 * because anything here looks before it writes. That distinction is the
 * whole safety story: a read-then-write generator double-bills the moment
 * two people press the button together, and this one cannot.
 *
 * The organization is never taken from the caller's body. It comes from
 * the active workspace, and the function runs as the caller besides, so
 * naming somebody else's organization is refused by RLS at the first write
 * rather than quietly finding nothing.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const runSchema = z
  .object({
    through: z.string().regex(DATE, "A date, as YYYY-MM-DD.").optional(),
    netDays: z.number().int().min(0).max(365).optional(),
    note: z.string().trim().min(1).max(500).nullish(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_billing_runs")
      .select(CRM_BILLING_RUN_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("ran_at", { ascending: false })
      .limit(200);
    if (error) return databaseErrorResponse(error);

    const runs = ((data ?? []) as unknown as CrmBillingRunRow[]).map(toBillingRunView);
    return jsonNoStore({
      runs,
      counts: {
        total: runs.length,
        invoicesCreated: runs.reduce((sum, run) => sum + run.invoicesCreated, 0),
        billedCents: runs.reduce((sum, run) => sum + run.totalCents, 0),
        /*
         * Periods a run found already invoiced. Almost always somebody
         * pressing the button twice, which is harmless here and worth
         * seeing rather than hiding.
         */
        alreadyBilled: runs.reduce((sum, run) => sum + run.plansAlreadyBilled, 0),
      },
      /*
       * Nothing runs this on a schedule. No part of this product does, and
       * saying so is more useful than a switch that would not fire.
       */
      automatic: { available: false, label: "Not Connected" },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_billing_runs_unavailable", message: "Billing runs could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = runSchema.parse(await readBoundedJson(request, 8_000).catch(() => ({})));
    const { client, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client.rpc("crm_generate_due_invoices", {
      p_organization: activeOrganization.id,
      p_through: payload.through ?? new Date().toISOString().slice(0, 10),
      p_net_days: payload.netDays ?? 30,
      p_note: payload.note ?? null,
    });
    if (error) {
      if (/net terms must be between/i.test(error.message ?? "")) {
        return jsonNoStore(
          { error: { code: "invalid_net_terms", message: "Net terms must be between 0 and 365 days." } },
          { status: 422 },
        );
      }
      return databaseErrorResponse(error);
    }

    const row = ((data ?? []) as {
      billing_run_id: string;
      plans_considered: number;
      invoices_created: number;
      plans_already_billed: number;
      total_cents: number | string;
    }[])[0];
    if (row === undefined) {
      return jsonNoStore(
        { error: { code: "crm_billing_run_not_recorded", message: "The billing run did not report." } },
        { status: 500 },
      );
    }

    return jsonNoStore(
      {
        run: {
          id: row.billing_run_id,
          plansConsidered: row.plans_considered,
          invoicesCreated: row.invoices_created,
          plansAlreadyBilled: row.plans_already_billed,
          totalCents: Number(row.total_cents),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_billing_run",
            message: error.issues[0]?.message ?? "The billing run could not be started.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_billing_run_failed", message: "The billing run could not be completed." } },
      { status: 500 },
    );
  }
}
