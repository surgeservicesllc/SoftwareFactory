import { z } from "zod";

import { dispatchGraphWorker } from "@/lib/orchestration/dispatch";
import { databaseErrorResponse, jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Decide a lifecycle gate.
 *
 * Without this the human half of "human gate" is theoretical: the worker halts
 * and opens the gate, and nothing but a SQL client can answer it. This is the
 * answer, made by a member of the organization under row level security with
 * `auth.uid()` recorded against the decision.
 *
 * ## The authority check is the database's, deliberately
 *
 * `decide_node_gate` refuses a human gate to anyone without manager authority,
 * and refuses an automatic approval that no anchored evidence backs — as a
 * `42501` and a `22023` carrying their reasons. Re-implementing either here
 * would create a second opinion that can drift from the first, and the
 * database's is the one that actually holds. `databaseErrorResponse` already
 * classifies both codes as client-safe, so the caller receives the sentence
 * this repository wrote rather than a generic refusal.
 *
 * ## A rejection is a decision, not a failure
 *
 * Rejecting returns 200 with the recorded decision. The stage stays blocked and
 * its dependents stay skipped, which is the point — but nothing went wrong, and
 * answering 4xx would tell the caller their request was malformed when it was
 * granted exactly as sent.
 */

const decisionSchema = z
  .object({
    approved: z.boolean(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  try {
    assertSameOriginRequest(request);

    const { gateId } = await params;
    if (!z.string().uuid().safeParse(gateId).success) {
      return jsonNoStore(
        { error: { code: "invalid_gate", message: "The gate identifier is invalid." } },
        { status: 400 },
      );
    }

    const parsed = decisionSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_request",
            message: "Send `approved`, and optionally a `reason`.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();

    const { data, error } = await client.rpc("decide_node_gate", {
      p_gate_id: gateId,
      p_approved: parsed.data.approved,
      p_reason: parsed.data.reason ?? null,
    });
    if (error) return databaseErrorResponse(error);

    const gate = (Array.isArray(data) ? data[0] : data) as
      | { id: string; state: string; stage: string; kind: string; reason: string | null }
      | null;

    /*
     * Best effort, approvals only: wake the worker so the approved stage's
     * dependents actually continue. Without this an approval strands the run
     * until the next scheduled or manual dispatch — the same "recorded, then
     * silence" gap the launch route had. The wake sits in its own try, binding
     * lookup included, so a wake that cannot happen never fails a decision the
     * database already recorded; the note reports which world the caller is
     * in. A rejection wakes nothing: the stage staying blocked IS the outcome.
     */
    let workerWoken = false;
    if (parsed.data.approved) {
      try {
        const gateRead = await client
          .from("graph_gates")
          .select("graph_id")
          .eq("id", gateId)
          .single();
        const graphId = (gateRead.data as { graph_id?: string } | null)?.graph_id;
        const graphRead = graphId
          ? await client.from("graphs").select("project_id").eq("id", graphId).single()
          : null;
        const projectId = (graphRead?.data as { project_id?: string } | null)?.project_id;
        if (graphId && projectId) {
          const target = await client
            .rpc("resolve_phase1c_command_target", {
              p_organization_id: activeOrganization.id,
              p_project_id: projectId,
            })
            .single();
          const targetRow = target.error
            ? null
            : (target.data as {
                app_id: number;
                external_installation_id: number;
                external_repository_id: number;
                repository_full_name: string;
              } | null);
          if (targetRow?.repository_full_name) {
            await dispatchGraphWorker(
              {
                appId: targetRow.app_id,
                externalInstallationId: targetRow.external_installation_id,
                externalRepositoryId: targetRow.external_repository_id,
                repositoryFullName: targetRow.repository_full_name,
              },
              graphId,
            );
            workerWoken = true;
          }
        }
      } catch {
        workerWoken = false;
      }
    }

    return jsonNoStore({
      gate: gate
        ? {
            id: gate.id,
            state: gate.state,
            stage: gate.stage,
            kind: gate.kind,
            reason: gate.reason,
          }
        : null,
      workerWoken,
      // Said plainly, because "approved" reads like "and now it is running".
      note: parsed.data.approved
        ? workerWoken
          ? "The gate is approved and the executor worker has been woken to continue the graph."
          : "The gate is approved. Nothing runs at this moment; the worker continues the "
            + "graph on its next scheduled or manual dispatch."
        : "The gate is rejected. The stage stays blocked and its dependents stay skipped.",
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "gate_decision_failed", message: "The gate decision could not be recorded." } },
      { status: 500 },
    );
  }
}
