import { taskDetailSchema } from "@/lib/server/control-plane-detail-schemas";
import { safeDetailProjection, tenantRpcDetailResponse } from "@/lib/server/tenant-detail";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return tenantRpcDetailResponse<Record<string, unknown>, unknown>({
    id: taskId,
    idParameter: "p_task_id",
    itemKey: "task",
    rpc: "get_task_detail",
    unavailableCode: "task_unavailable",
    unavailableMessage: "Task details could not be loaded.",
    shape: (row) => taskDetailSchema.parse(safeDetailProjection(row)),
  });
}
