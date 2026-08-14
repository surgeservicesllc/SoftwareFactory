import { z } from "zod";

import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const reportSchema = z
  .object({ periodHours: z.number().int().min(1).max(168).default(24) })
  .strict();

type ReportRow = {
  id: string;
  title: string;
  summary: string | null;
  content: Record<string, unknown>;
  period_start: string | null;
  period_end: string | null;
  published_at: string | null;
};

/**
 * Generate the daily operations report from recorded evidence.
 *
 * Every figure comes from a stored row. Executed rollbacks and executed repairs
 * are always zero because no executor exists — the report says so rather than
 * omitting the line.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = reportSchema.safeParse(await readBoundedJson(request, 2 * 1024));
    if (!parsed.success) {
      return invalidRequest("Provide a reporting period between 1 and 168 hours.");
    }

    const context = await operationsContext();
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

    const { data, error } = await context.client
      .rpc("generate_operations_report", {
        p_organization_id: context.activeOrganization.id,
        p_period_hours: parsed.data.periodHours,
      })
      .single();

    if (error) return databaseErrorResponse(error);
    const report = data as ReportRow;

    return jsonNoStore(
      {
        ...OPERATIONS_EXECUTION_ENVELOPE,
        report: {
          id: report.id,
          title: report.title,
          summary: report.summary,
          content: report.content,
          periodStart: report.period_start,
          periodEnd: report.period_end,
          publishedAt: report.published_at,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(
      error,
      "operations_report_failed",
      "The operations report could not be generated.",
    );
  }
}
