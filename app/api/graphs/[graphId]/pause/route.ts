import { z } from "zod";

import { dispatchGraphWorker } from "@/lib/orchestration/dispatch";
import { phase1CTargetSchema } from "@/lib/graph/phase1c-gate-bridge";
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
 * Pause and Resume, at the route boundary.
 *
 * The database owns every rule (membership, the withdrawn refusal,
 * idempotence, the audit event); the engine honors a pause at its next wave
 * boundary. This route passes the caller's request through unchanged and
 * answers with what actually happened. On resume it also wakes the worker
 * through the project's verified GitHub binding — the same best-effort wake
 * the launch route fires — because a resumed graph nobody dispatches would
 * be a Resume button that changes a row and nothing else.
 */

const paramsSchema = z.object({ graphId: z.string().uuid() }).strict();
const bodySchema = z.object({ paused: z.boolean() }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ graphId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_graph_id", message: "The graph id is not a UUID." } },
        { status: 400 },
      );
    }
    const body = bodySchema.safeParse(await readBoundedJson(request) ?? {});
    if (!body.success) {
      return jsonNoStore(
        { error: { code: "invalid_pause_request", message: "Say whether the graph should be paused or resumed." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("set_graph_pause_as_member", {
      p_organization_id: activeOrganization.id,
      p_graph_id: parsed.data.graphId,
      p_paused: body.data.paused,
    });
    if (error) {
      if (error.message?.includes("graph_withdrawn")) {
        return jsonNoStore(
          {
            error: {
              code: "graph_withdrawn",
              message: "This graph was withdrawn, which is permanent. "
                + "A withdrawn graph cannot be paused or resumed.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }

    const graph = data as {
      id?: string;
      project_id?: string;
      pause_requested_at?: string | null;
    } | null;

    /*
     * Best effort, resume only: wake the worker so the graph is actually
     * picked back up. Inside its own try, binding lookup included, so the
     * pause change — which already happened — is never reported as failed
     * over a wake that could not.
     */
    let workerWoken = false;
    if (!body.data.paused && graph?.project_id) {
      try {
        const target = await client.rpc("resolve_phase1c_command_target", {
          p_organization_id: activeOrganization.id,
          p_project_id: graph.project_id,
        }).single();
        const binding = target.error ? null : phase1CTargetSchema.safeParse(target.data);
        if (binding?.success) {
          const dispatched = await dispatchGraphWorker(
            {
              appId: binding.data.app_id,
              externalInstallationId: binding.data.external_installation_id,
              externalRepositoryId: binding.data.external_repository_id,
              repositoryFullName: binding.data.repository_full_name,
            },
            parsed.data.graphId,
          );
          workerWoken = dispatched.dispatched;
        }
      } catch {
        workerWoken = false;
      }
    }

    return jsonNoStore({
      graphId: graph?.id ?? parsed.data.graphId,
      pausedAt: graph?.pause_requested_at ?? null,
      workerWoken,
      note: body.data.paused
        ? "The graph is paused: running work finishes its current step, nothing new starts, "
          + "and no worker will claim it until it is resumed."
        : workerWoken
          ? "The graph is resumed and the executor worker has been woken to pick it back up. "
            + "Completed work carries forward."
          : "The graph is resumed and claimable again, but the executor is Not Connected or "
            + "its verified GitHub binding could not dispatch; a scheduled or manual dispatch "
            + "will pick it up.",
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "graph_pause_unavailable", message: "The graph's pause state could not be changed." } },
      { status: 500 },
    );
  }
}
