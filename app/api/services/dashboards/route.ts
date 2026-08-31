import {
  toReceivableBucketView,
  toRetentionView,
  toRevenueMonthView,
  toRouteDayView,
  toTechnicianProductivityView,
  type CrmReceivableBucketRow,
  type CrmRetentionRow,
  type CrmRevenueMonthRow,
  type CrmRouteDayRow,
  type CrmTechnicianProductivityRow,
} from "@/lib/services/crm";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The operating dashboards.
 *
 * Every number here is aggregated in the database by a SECURITY INVOKER
 * function, so it covers the whole book rather than the first five
 * thousand rows a route could fetch — and it still cannot reach past the
 * reader's own organization, because RLS is evaluated normally for an
 * invoker. There is no `.limit()` in this file, and that is the point: a
 * dashboard built on a truncated fetch is right only while the book is
 * small.
 *
 * Nulls arriving from SQL are passed through as nulls. A rate over an
 * empty denominator is not a zero, and rounding it to one here would undo
 * the whole reason it is computed that way.
 */

/** Bounded so a caller cannot ask for an unbounded scan. */
function window(raw: string | null, fallback: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const params = new URL(request.url).searchParams;
    const months = window(params.get("months"), 12, 36);
    const productivityDays = window(params.get("productivityDays"), 90, 365);
    const routeDays = window(params.get("routeDays"), 14, 90);

    const [revenue, aging, retention, productivity, routes] = await Promise.all([
      client.rpc("crm_revenue_by_month", { p_months: months }),
      client.rpc("crm_receivable_aging"),
      client.rpc("crm_retention_summary"),
      client.rpc("crm_technician_productivity", { p_days: productivityDays }),
      client.rpc("crm_route_density", { p_days: routeDays }),
    ]);
    for (const result of [revenue, aging, retention, productivity, routes]) {
      if (result.error) return databaseErrorResponse(result.error);
    }

    const months_ = ((revenue.data ?? []) as CrmRevenueMonthRow[]).map(toRevenueMonthView);
    const buckets = ((aging.data ?? []) as CrmReceivableBucketRow[]).map(toReceivableBucketView);
    const technicians = ((productivity.data ?? []) as CrmTechnicianProductivityRow[]).map(
      toTechnicianProductivityView,
    );
    const days = ((routes.data ?? []) as CrmRouteDayRow[]).map(toRouteDayView);
    const book = ((retention.data ?? []) as CrmRetentionRow[])[0];

    return jsonNoStore({
      organizationId: activeOrganization.id,
      windows: { months, productivityDays, routeDays },
      revenue: {
        months: months_,
        totals: {
          invoicedCents: months_.reduce((sum, month) => sum + month.invoicedCents, 0),
          collectedCents: months_.reduce((sum, month) => sum + month.collectedCents, 0),
          refundedCents: months_.reduce((sum, month) => sum + month.refundedCents, 0),
        },
      },
      receivable: {
        buckets,
        outstandingCents: buckets.reduce((sum, bucket) => sum + bucket.balanceCents, 0),
        /*
         * Past due, which is every bucket except the two that are not a
         * problem: what is not yet due, and what carries no due date at
         * all. Folding those into "overdue" is the usual way an aging
         * report overstates itself.
         */
        overdueCents: buckets
          .filter((bucket) => bucket.bucket !== "current" && bucket.bucket !== "undated")
          .reduce((sum, bucket) => sum + bucket.balanceCents, 0),
        undatedCents: buckets.find((bucket) => bucket.bucket === "undated")?.balanceCents ?? 0,
      },
      retention: book === undefined ? null : toRetentionView(book),
      productivity: {
        technicians,
        /*
         * Technicians the window contains no scheduled work for. Reported
         * rather than filtered out: an idle roster is the finding, and
         * dropping those rows would flatter every average above.
         */
        idle: technicians.filter((technician) => technician.scheduled === 0).length,
        runningShifts: technicians.reduce((sum, technician) => sum + technician.runningShifts, 0),
      },
      routes: {
        days,
        /*
         * Drive time cannot be computed without a mapping provider, and
         * none is connected. What is reported is the shape of the day from
         * real scheduled windows; the sequencing that needs distances is
         * absent rather than estimated.
         */
        optimization: { available: false, label: "Not Connected" },
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_dashboards_unavailable", message: "The dashboards could not be read." } },
      { status: 500 },
    );
  }
}
