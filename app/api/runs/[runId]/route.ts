import { runDetailSchema } from "@/lib/server/control-plane-detail-schemas";
import { safeDetailProjection, tenantRpcDetailResponse } from "@/lib/server/tenant-detail";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return tenantRpcDetailResponse<Record<string, unknown>, unknown>({
    id: runId,
    idParameter: "p_run_id",
    itemKey: "run",
    rpc: "get_agent_run_detail",
    unavailableCode: "run_unavailable",
    unavailableMessage: "Run details could not be loaded.",
    shape: (row) => runDetailSchema.parse(safeDetailProjection(row)),
  });
}
