import { z } from "zod";

import { launchCommandAnalysisGraph } from "@/lib/orchestration/analysis-launch";
import { dispatchGraphWorker } from "@/lib/orchestration/dispatch";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
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

const bodySchema = z.object({
  projectId: z.string().uuid(),
  commandType: z.enum([
    "fix_bug", "build_feature", "audit", "test",
    "mobile", "security", "performance", "other",
  ]).default("other"),
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
    const outcome = await launchCommandAnalysisGraph(client, {
      organizationId: activeOrganization.id,
      projectId: parsed.data.projectId,
      commandId,
      commandType: parsed.data.commandType,
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
    const target = await client
      .rpc("resolve_phase1c_command_target", {
        p_organization_id: activeOrganization.id,
        p_project_id: parsed.data.projectId,
      })
      .single();
    const targetRow = target.error ? null : (target.data as TargetRow | null);
    if (targetRow?.repository_full_name) {
      try {
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
      } catch {
        workerWoken = false;
      }
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
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "analysis_launch_unavailable", message: "The analysis could not be launched." } },
      { status: 500 },
    );
  }
}
