import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { safeDetailProjection } from "@/lib/server/tenant-detail";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const workerStatusSchema = z.object({
  connectionStatus: z.string().trim().min(1).max(40),
  statusLabel: z.string().trim().min(1).max(80),
  lastHeartbeatAt: z.string().datetime({ offset: true }).nullable(),
  activeWorkers: z.number().int().min(0).max(1000),
  availableWorkers: z.number().int().min(0).max(1000),
  staleAfterSeconds: z.number().int().min(1).max(86_400),
}).strict();

export async function GET() {
  try {
    const context = await requireActiveOrganization();
    const { data, error } = await context.client.rpc("get_phase1c_worker_status", {
      p_organization_id: context.activeOrganization.id,
    });
    if (error) return databaseErrorResponse(error);

    const row = Array.isArray(data) ? data[0] : data;
    const parsed = workerStatusSchema.safeParse(safeDetailProjection(row));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "worker_status_invalid", message: "Worker status evidence is unavailable." } },
        { status: 500 },
      );
    }

    const source = parsed.data;
    const heartbeatMs = source.lastHeartbeatAt ? Date.parse(source.lastHeartbeatAt) : Number.NaN;
    const heartbeatAgeMs = Date.now() - heartbeatMs;
    const freshHeartbeat = Number.isFinite(heartbeatMs)
      && heartbeatAgeMs >= -60_000
      && heartbeatAgeMs <= source.staleAfterSeconds * 1000;
    const connected = source.connectionStatus.toLowerCase() === "connected"
      && source.availableWorkers > 0
      && freshHeartbeat;
    const stale = !connected && source.lastHeartbeatAt !== null;

    return jsonNoStore({
      activeOrganizationId: context.activeOrganization.id,
      worker: {
        connectionStatus: connected ? "connected" : stale ? "stale" : "not_connected",
        statusLabel: connected ? "Worker Connected" : stale ? "Worker Stale" : "Worker Not Connected",
        lastHeartbeatAt: source.lastHeartbeatAt,
        activeWorkers: source.activeWorkers,
        availableWorkers: source.availableWorkers,
        staleAfterSeconds: source.staleAfterSeconds,
      },
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "worker_status_unavailable", message: "Worker status could not be loaded." } },
      { status: 500 },
    );
  }
}
