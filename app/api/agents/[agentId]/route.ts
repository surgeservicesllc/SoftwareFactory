import { agentDetailSchema } from "@/lib/server/control-plane-detail-schemas";
import { safeDetailProjection, tenantRpcDetailResponse } from "@/lib/server/tenant-detail";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return tenantRpcDetailResponse<Record<string, unknown>, unknown>({
    id: agentId,
    idParameter: "p_agent_id",
    itemKey: "agent",
    rpc: "get_agent_detail",
    unavailableCode: "agent_unavailable",
    unavailableMessage: "Agent details could not be loaded.",
    shape: (row) => agentDetailSchema.parse(safeDetailProjection(row)),
  });
}
