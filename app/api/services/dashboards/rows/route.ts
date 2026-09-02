import {
  DASHBOARD_FIGURES,
  figureKeyProblem,
  toDashboardRowView,
  type CrmDashboardRowRow,
  type DashboardFigure,
} from "@/lib/services/nothing-hidden";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The rows behind a dashboard figure, by the figure's own predicate —
 * `crm_dashboard_rows` repeats the exact WHERE the aggregate uses, so the
 * count on the tile and the list under it cannot disagree. Bounded at 500
 * rows, and the ceiling is reported rather than silently applied.
 */

const ROW_CEILING = 500;

function window(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const params = new URL(request.url).searchParams;
    const figure = params.get("figure") ?? "";
    if (!(DASHBOARD_FIGURES as readonly string[]).includes(figure)) {
      return jsonNoStore(
        { error: { code: "unknown_figure", message: `figure must be one of ${DASHBOARD_FIGURES.join(", ")}.` } },
        { status: 400 },
      );
    }
    const key = params.get("key");
    const problem = figureKeyProblem(figure as DashboardFigure, key);
    if (problem !== null) {
      return jsonNoStore({ error: { code: "invalid_key", message: problem } }, { status: 400 });
    }
    const days = window(params.get("days"), 90, 365);

    const read = await client
      .rpc("crm_dashboard_rows", {
        p_organization: activeOrganization.id,
        p_figure: figure,
        p_key: key === "" ? null : key,
        p_days: days,
      })
      .limit(ROW_CEILING);
    if (read.error) return databaseErrorResponse(read.error);
    const rows = ((read.data ?? []) as unknown as CrmDashboardRowRow[]).map(toDashboardRowView);
    return jsonNoStore({
      figure,
      key: key === "" ? null : key,
      window: { days },
      rows,
      ceiling: { rows: ROW_CEILING, reached: rows.length >= ROW_CEILING },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_dashboard_rows_unavailable", message: "The rows behind that figure could not be read." } },
      { status: 500 },
    );
  }
}
