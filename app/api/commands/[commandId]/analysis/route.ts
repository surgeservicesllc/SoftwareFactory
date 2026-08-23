import { z } from "zod";

import { launchCommandAnalysisGraph } from "@/lib/orchestration/analysis-launch";
import { dispatchGraphWorker } from "@/lib/orchestration/dispatch";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Launch (or return) the one analysis graph a record-only Claude command may
 * have — the explicit "Run analysis" control.
 *
 * The submit and replay paths launch automatically, but both depend on the
 * request that happens to carry the command; a command recorded before the
 * launch feature, or whose submit raced a deploy, would otherwise have no
 * doorway at all. This endpoint is that doorway: idempotent through the
 * database's unique link, authorized by the same membership check every
 * launch takes, and honest about whether the worker was woken.
 */

/*
 * The body names the project, and nothing else.
 *
 * It used to carry `commandType`, defaulted to `other`. The command list this
 * button renders from never exposed the type, so the client could not send it
 * and every manual launch defaulted — a `fix_bug` command got the
 * `production_readiness` template instead of `bug_sweep`, silently, because
 * `other` maps to a real template rather than refusing. The submit and replay
 * paths were unaffected: both pass the type they just recorded.
 *
 * The type is read from the command row below instead. That is the source of
 * truth, and it also stops the browser choosing which analysis template runs.
 */
const bodySchema = z.object({
  projectId: z.string().uuid(),
}).strict();

type TargetRow = {
  app_id: number;
  external_installation_id: number;
  external_repository_id: number;
  repository_full_name: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ commandId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { commandId } = await params;
    if (!z.string().uuid().safeParse(commandId).success) {
      return jsonNoStore(
        { error: { code: "invalid_command", message: "The command id is invalid." } },
        { status: 400 },
      );
    }
    const parsed = bodySchema.safeParse(await readBoundedJson(request, 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_request", message: "Provide the command's projectId." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();

    /*
     * The command's own type, read under the caller's RLS.
     *
     * A command the caller cannot see returns no row, which is the same
     * refusal the launch itself would give — stated here rather than sending a
     * guessed type into the doorway.
     */
    const { data: commandRow, error: commandError } = await client
      .from("commands")
      .select("command_type")
      .eq("id", commandId)
      .eq("organization_id", activeOrganization.id)
      .maybeSingle();
    if (commandError) return databaseErrorResponse(commandError);
    if (!commandRow) {
      return jsonNoStore(
        {
          error: {
            code: "command_not_found",
            message: "That request is not in this workspace.",
          },
        },
        { status: 404 },
      );
    }

    const outcome = await launchCommandAnalysisGraph(client, {
      organizationId: activeOrganization.id,
      projectId: parsed.data.projectId,
      commandId,
      commandType: String(commandRow.command_type ?? "other"),
    });
    if (!outcome.launched) {
      // The database's refusal is the answer — a manual Codex command, a
      // foreign command, or a missing linking migration all land here.
      return jsonNoStore(
        { error: { code: "analysis_launch_refused", message: outcome.reason } },
        { status: 409 },
      );
    }

    // Best effort: wake the graph worker through the project's own verified
    // GitHub binding. A wake that cannot happen leaves the graph planned for
    // the scheduled or manual dispatch — reported, never hidden.
    let workerWoken = false;
    try {
      /*
       * The whole wake is inside the try, including the binding lookup.
       *
       * Only the dispatch was. A throw from the lookup — not an `error` on the
       * result, a throw — escaped to the 500 handler *after* the graph had
       * already been created, so the caller was told the launch failed while
       * the database held a launched graph. Best effort has to mean the
       * launch's answer never depends on it.
       */
      const target = await client
        .rpc("resolve_phase1c_command_target", {
          p_organization_id: activeOrganization.id,
          p_project_id: parsed.data.projectId,
        })
        .single();
      const targetRow = target.error ? null : (target.data as TargetRow | null);
      if (targetRow?.repository_full_name) {
        await dispatchGraphWorker(
          {
            appId: targetRow.app_id,
            externalInstallationId: targetRow.external_installation_id,
            externalRepositoryId: targetRow.external_repository_id,
            repositoryFullName: targetRow.repository_full_name,
          },
          outcome.graphId,
        );
        workerWoken = true;
      }
    } catch {
      workerWoken = false;
    }

    return jsonNoStore(
      {
        analysisGraph: {
          launched: true,
          graphId: outcome.graphId,
          templateKey: outcome.templateKey,
          workerWoken,
        },
      },
      { status: 202 },
    );
  } catch (error) {
    // A request-shape refusal (origin, body size) carries its own status and
    // message; collapsing it into a generic 500 hid the one clue a failed
    // tap leaves behind.
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "analysis_launch_unavailable", message: "The analysis could not be launched." } },
      { status: 500 },
    );
  }
}
