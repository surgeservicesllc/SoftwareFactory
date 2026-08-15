import type {
  SchedulingCapacity,
  SchedulingProject,
  SchedulingQueueItem,
} from "@/lib/portfolio/scheduling";
import { jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Portfolio scheduling: capacity, the queue, and what is holding it up.
 *
 * Three RPCs rather than three table reads, because `agent_runs`, `tasks` and
 * `commands` are not selectable by the browser at all. The functions are
 * SECURITY DEFINER with their own membership checks, so this route grants no
 * visibility the caller does not have — an outsider gets empty results from the
 * database itself rather than from a filter here.
 *
 * Each section degrades independently. A queue that cannot be read must not
 * take the capacity summary down with it: the console says which section is
 * unavailable rather than showing a page-wide error, and never shows a zero it
 * did not measure.
 */

type Row = Record<string, unknown>;

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const organizationId = activeOrganization.id;

    const capacityResult = await client.rpc("portfolio_capacity_overview", {
      p_organization_id: organizationId,
    });
    const queueResult = await client.rpc("portfolio_scheduling_queue", {
      p_limit: 50,
      p_organization_id: organizationId,
    });
    const projectResult = await client.rpc("portfolio_project_capacity", {
      p_organization_id: organizationId,
    });

    const unavailable: string[] = [];
    if (capacityResult.error) unavailable.push("capacity");
    if (queueResult.error) unavailable.push("queue");
    if (projectResult.error) unavailable.push("projects");

    const capacityRow = (capacityResult.data as Row[] | null)?.[0] ?? null;
    const capacity: SchedulingCapacity | null = capacityRow
      ? {
          activeRuns: number(capacityRow.active_runs),
          emergencyQueued: number(capacityRow.emergency_queued),
          emergencyReserved: number(capacityRow.emergency_reserved),
          fairnessPromotionSeconds: number(capacityRow.fairness_promotion_seconds),
          focusedProjects: number(capacityRow.focused_projects),
          openBreakers: number(capacityRow.open_breakers),
          ordinaryCeiling: number(capacityRow.ordinary_ceiling),
          organizationLimit: number(capacityRow.organization_limit),
          pausedProjects: number(capacityRow.paused_projects),
          queuedRuns: number(capacityRow.queued_runs),
          workerCapacity: number(capacityRow.worker_capacity),
          workerCount: number(capacityRow.worker_count),
          workerLeases: number(capacityRow.worker_leases),
        }
      : null;

    const queue: SchedulingQueueItem[] = ((queueResult.data as Row[] | null) ?? []).map((row) => ({
      blockedReason: typeof row.blocked_reason === "string" ? row.blocked_reason : null,
      effectivePriority: number(row.effective_priority),
      emergency: row.emergency === true,
      projectName: String(row.project_name ?? ""),
      projectPriority: number(row.project_priority),
      queuePosition: typeof row.queue_position === "number" ? row.queue_position : null,
      runId: String(row.run_id ?? ""),
      runStatus: String(row.run_status ?? ""),
      strategicFocus: row.strategic_focus === true,
      taskTitle: String(row.task_title ?? ""),
      waitingSeconds: number(row.waiting_seconds),
    }));

    const projects: SchedulingProject[] = ((projectResult.data as Row[] | null) ?? []).map(
      (row) => ({
        activeRuns: number(row.active_runs),
        engineeringPaused: row.engineering_paused === true,
        engineeringPauseReason:
          typeof row.engineering_pause_reason === "string" ? row.engineering_pause_reason : null,
        engineeringPriority: number(row.engineering_priority),
        maximumConcurrentRuns: number(row.maximum_concurrent_runs),
        projectId: String(row.project_id ?? ""),
        projectName: String(row.project_name ?? ""),
        queuedRuns: number(row.queued_runs),
        strategicFocus: row.strategic_focus === true,
      }),
    );

    return jsonNoStore({
      scheduling: { capacity, projects, queue, unavailable },
    });
  } catch (cause) {
    // The helper answers only for tenancy and session boundary failures and
    // returns null for everything else, so it needs a fallback rather than
    // being returned directly.
    const boundaryResponse = supabaseBoundaryErrorResponse(cause);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      {
        error: {
          code: "scheduling_unavailable",
          message: "Portfolio scheduling could not be loaded.",
        },
      },
      { status: 500 },
    );
  }
}
