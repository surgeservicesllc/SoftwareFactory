import { z } from "zod";

import {
  CRM_WDO_FINDING_COLUMNS,
  CRM_WDO_FINDING_KINDS,
  toWdoFindingView,
  type CrmWdoFindingRow,
} from "@/lib/services/crm";
import { ApiRequestError, jsonNoStore, readBoundedJson, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * The findings on one report, and the marks on its diagram.
 *
 * Coordinates are optional and travel as a pair. A finding recorded
 * without them is ordinary — an inspector writes "damage, crawlspace
 * joists" long before anybody puts a pin in a drawing — so the response
 * reports how many of the findings are actually placed rather than letting
 * a partial diagram pass for a complete one.
 */

const createSchema = z
  .object({
    kind: z.enum(CRM_WDO_FINDING_KINDS as unknown as [string, ...string[]]),
    organism: z.string().trim().min(1).max(120).nullish(),
    area: z.string().trim().min(1, "Say where.").max(300),
    positionX: z.number().min(0).max(1).nullish(),
    positionY: z.number().min(0).max(1).nullish(),
    note: z.string().trim().min(1).max(2000).nullish(),
    treatmentNote: z.string().trim().min(1).max(2000).nullish(),
  })
  .strict()
  .refine(
    (value) =>
      (value.positionX === null || value.positionX === undefined)
      === (value.positionY === null || value.positionY === undefined),
    { message: "A mark needs both coordinates, or neither." },
  );

export async function GET(
  _request: Request,
  context: { params: Promise<{ inspectionId: string }> },
) {
  const { inspectionId } = await context.params;
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_wdo_findings")
      .select(CRM_WDO_FINDING_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("inspection_id", inspectionId)
      .order("kind", { ascending: true })
      .limit(500);
    if (error) throw error;

    const findings = ((data ?? []) as unknown as CrmWdoFindingRow[]).map(toWdoFindingView);

    return jsonNoStore({
      findings,
      counts: {
        total: findings.length,
        /* The set the database's issue-time check uses. A page drawing the
         * line anywhere else would show a verdict the database would
         * refuse to issue. */
        adverse: findings.filter((finding) => finding.adverse).length,
        placed: findings.filter((finding) => finding.placed).length,
        unplaced: findings.filter((finding) => !finding.placed).length,
      },
    });
  } catch (error) {
    return failure(error, "invalid_wdo_findings", "wdo_findings_unavailable",
      "The findings could not be loaded.");
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> },
) {
  const { inspectionId } = await context.params;
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 64_000));
    const { client, activeOrganization, user } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_wdo_findings")
      .insert({
        organization_id: activeOrganization.id,
        inspection_id: inspectionId,
        kind: payload.kind,
        organism: payload.organism ?? null,
        area: payload.area,
        position_x: payload.positionX ?? null,
        position_y: payload.positionY ?? null,
        note: payload.note ?? null,
        treatment_note: payload.treatmentNote ?? null,
        created_by: user.id,
      } as never)
      .select(CRM_WDO_FINDING_COLUMNS)
      .single();
    if (error) {
      if (/is issued; its findings can no longer change/.test(error.message ?? "")) {
        // The document would stop matching the findings it was issued
        // against. That refusal is the answer.
        return jsonNoStore(
          { error: { code: "report_already_issued", message: error.message } },
          { status: 409 },
        );
      }
      throw error;
    }

    return jsonNoStore(
      { finding: toWdoFindingView(data as unknown as CrmWdoFindingRow) },
      { status: 201 },
    );
  } catch (error) {
    return failure(error, "invalid_wdo_finding", "wdo_finding_not_recorded",
      "That finding could not be recorded.");
  }
}

function failure(error: unknown, invalidCode: string, failureCode: string, message: string) {
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof z.ZodError) {
    return jsonNoStore(
      { error: { code: invalidCode, message: error.issues[0]?.message ?? message } },
      { status: 422 },
    );
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code: failureCode, message } }, { status: 500 });
}
