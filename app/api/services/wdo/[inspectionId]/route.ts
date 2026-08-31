import { z } from "zod";

import {
  CRM_WDO_INSPECTION_COLUMNS,
  toWdoInspectionView,
  type CrmWdoInspectionRow,
} from "@/lib/services/crm";
import { ApiRequestError, jsonNoStore, readBoundedJson, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * Edit a draft, or issue it.
 *
 * There is no DELETE. A WDO report is the record somebody relied on; the
 * way to withdraw one is a new report that supersedes it. And a report
 * already issued is frozen — the database refuses the edit either way, so
 * what this route does is turn that refusal into an answer rather than a
 * 500.
 */

const patchSchema = z
  .object({
    structuresInspected: z.string().trim().min(1).max(1000).optional(),
    visibleEvidence: z.boolean().optional(),
    obstructions: z.string().trim().min(1).max(2000).nullish(),
    inaccessibleAreas: z.string().trim().min(1).max(2000).nullish(),
    recommendation: z.string().trim().min(1).max(4000).nullish(),
    // `status` and `issuedAt` are absent on purpose. Issuing is not an
    // edit — it runs a check across two tables — so it has its own action.
  })
  .strict();

const actionSchema = z.object({ action: z.literal("issue") }).strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> },
) {
  const { inspectionId } = await context.params;
  try {
    assertSameOriginRequest(request);
    const body = await readBoundedJson(request, 64_000);

    // One route, two verbs, told apart by shape rather than by a second
    // path segment: issuing is what the page's primary button does.
    const asAction = actionSchema.safeParse(body);
    if (asAction.success) {
      const { client } = await requireActiveOrganization();
      const { data, error } = await client.rpc("crm_wdo_issue_report", {
        p_inspection: inspectionId,
      });
      if (error) return issueFailure(error);
      return jsonNoStore({
        inspection: toWdoInspectionView(data as unknown as CrmWdoInspectionRow),
      });
    }

    const payload = patchSchema.parse(body);
    const { client, activeOrganization } = await requireActiveOrganization();

    const patch: Record<string, unknown> = {};
    if (payload.structuresInspected !== undefined) patch.structures_inspected = payload.structuresInspected;
    if (payload.visibleEvidence !== undefined) patch.visible_evidence = payload.visibleEvidence;
    if (payload.obstructions !== undefined) patch.obstructions = payload.obstructions;
    if (payload.inaccessibleAreas !== undefined) patch.inaccessible_areas = payload.inaccessibleAreas;
    if (payload.recommendation !== undefined) patch.recommendation = payload.recommendation;
    if (Object.keys(patch).length === 0) {
      return jsonNoStore(
        { error: { code: "empty_patch", message: "Nothing to change." } },
        { status: 422 },
      );
    }

    const { data, error } = await client
      .from("crm_wdo_inspections")
      .update(patch as never)
      .eq("id", inspectionId)
      .eq("organization_id", activeOrganization.id)
      .select(CRM_WDO_INSPECTION_COLUMNS)
      .single();
    if (error) return issueFailure(error);

    return jsonNoStore({
      inspection: toWdoInspectionView(data as unknown as CrmWdoInspectionRow),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_wdo_patch",
            message: error.issues[0]?.message ?? "That change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "wdo_not_updated", message: "That report could not be updated." } },
      { status: 500 },
    );
  }
}

/**
 * The database's refusals are the inspector's answer, not a server error.
 * Each message it raises says exactly what is wrong with the report, and
 * flattening them into "something went wrong" would throw away the only
 * useful part.
 */
function issueFailure(error: { code?: string; message?: string }): Response {
  const message = error.message ?? "";

  if (/already issued on/.test(message) || /can no longer change/.test(message)
      || /supersedes it/.test(message)) {
    return jsonNoStore(
      { error: { code: "report_already_issued", message } },
      { status: 409 },
    );
  }
  if (/no visible evidence was observed while/.test(message)
      || /records no infestation, damage or previous infestation/.test(message)) {
    // The report contradicts its own findings. That is a 422 about the
    // document, and the database's own sentence is the clearest statement
    // of it anybody is going to write.
    return jsonNoStore(
      { error: { code: "report_contradicts_findings", message } },
      { status: 422 },
    );
  }
  if (error.code === "P0002" || /no such inspection/.test(message)) {
    return jsonNoStore(
      { error: { code: "wdo_not_found", message: "No such report." } },
      { status: 404 },
    );
  }
  return jsonNoStore(
    { error: { code: "wdo_not_updated", message: "That report could not be updated." } },
    { status: 500 },
  );
}
