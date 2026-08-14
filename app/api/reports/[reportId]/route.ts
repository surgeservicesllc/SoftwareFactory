import { reportDetailSchema } from "@/lib/server/control-plane-detail-schemas";
import { safeDetailProjection, tenantRpcDetailResponse } from "@/lib/server/tenant-detail";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return tenantRpcDetailResponse<Record<string, unknown>, unknown>({
    id: reportId,
    idParameter: "p_report_id",
    itemKey: "report",
    rpc: "get_report_detail",
    unavailableCode: "report_unavailable",
    unavailableMessage: "Report details could not be loaded.",
    shape: (row) => reportDetailSchema.parse(safeDetailProjection(row)),
  });
}
