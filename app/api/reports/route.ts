import { tenantRpcListResponse } from "@/lib/server/tenant-list";

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
  project_name: string | null;
};

export async function GET(request: Request) {
  return tenantRpcListResponse<ReportRow>({
    request,
    rpc: "list_reports",
    unavailableCode: "reports_unavailable",
    unavailableMessage: "Reports could not be loaded.",
    shape: (rows) => ({
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
            ? { id: row.project_id, name: row.project_name ?? "Project" }
            : null,
        })),
      }),
  });
}
