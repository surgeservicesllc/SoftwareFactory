import { lookupNames, tenantListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

type ReportRow = {
  id: string;
  project_id: string | null;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  period_start: string | null;
  period_end: string | null;
  published_at: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  return tenantListResponse<ReportRow>({
    request,
    table: "reports",
    // `content` is excluded from the list view; a summary is enough to choose
    // a report, and the full body may embed provider or repository detail.
    columns: "id,project_id,type,status,title,summary,period_start,period_end,published_at,created_at",
    orderColumn: "created_at",
    unavailableCode: "reports_unavailable",
    unavailableMessage: "Reports could not be loaded.",
    shape: async (rows, context) => {
      const projects = await lookupNames(context, "projects", rows.map((row) => row.project_id));
      return {
        reports: rows.map((row) => ({
          id: row.id,
          type: row.type,
          status: row.status,
          title: row.title,
          summary: row.summary,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          publishedAt: row.published_at,
          createdAt: row.created_at,
          project: row.project_id
            ? { id: row.project_id, name: projects.get(row.project_id) ?? "Project" }
            : null,
        })),
      };
    },
  });
}
