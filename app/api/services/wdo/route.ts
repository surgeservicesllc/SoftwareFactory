import { z } from "zod";

import {
  CRM_WDO_DIAGRAM_KINDS,
  CRM_WDO_INSPECTION_COLUMNS,
  toWdoInspectionView,
  toWdoSummaryView,
  type CrmWdoInspectionRow,
  type CrmWdoSummaryRow,
} from "@/lib/services/crm";
import { ApiRequestError, jsonNoStore, readBoundedJson, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * WDO inspection reports.
 *
 * `visibleEvidence` is REQUIRED on create and has no default. An inspector
 * who has not answered it has not finished the inspection, and a default
 * of either value would be this route answering a legal question on their
 * behalf.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    propertyId: z.string().uuid(),
    workOrderId: z.string().uuid().nullish(),
    inspectorTechnicianId: z.string().uuid(),
    reportNumber: z.string().trim().min(1).max(60),
    inspectedOn: z.string().regex(DATE, "A date, as YYYY-MM-DD.").optional(),
    structuresInspected: z.string().trim().min(1, "Say what was inspected.").max(1000),
    // No default, deliberately.
    visibleEvidence: z.boolean(),
    obstructions: z.string().trim().min(1).max(2000).nullish(),
    inaccessibleAreas: z.string().trim().min(1).max(2000).nullish(),
    recommendation: z.string().trim().min(1).max(4000).nullish(),
    diagramKind: z.enum(CRM_WDO_DIAGRAM_KINDS as unknown as [string, ...string[]]).default("outline"),
    supersedesId: z.string().uuid().nullish(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId");

    let query = client
      .from("crm_wdo_inspections")
      .select(CRM_WDO_INSPECTION_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("inspected_on", { ascending: false })
      .limit(200);
    if (accountId !== null) query = query.eq("account_id", accountId);

    const [listed, summary] = await Promise.all([query, client.rpc("crm_wdo_summary")]);
    if (listed.error) throw listed.error;
    if (summary.error) throw summary.error;

    const summaryRow = ((summary.data ?? []) as CrmWdoSummaryRow[])[0];

    return jsonNoStore({
      inspections: ((listed.data ?? []) as unknown as CrmWdoInspectionRow[]).map(toWdoInspectionView),
      /*
       * Null when the workspace has no reports at all. A row of zeroes
       * would read as "we inspected nothing and found nothing", which is
       * a different claim from "nobody has inspected anything yet".
       */
      summary: summaryRow === undefined ? null : toWdoSummaryView(summaryRow),
      storage: {
        connected: false,
        note: "Uploading a floor plan needs object storage, which is Not Connected. Reports use the built-in structure outline.",
      },
    });
  } catch (error) {
    return failure(error, "invalid_wdo_query", "wdo_unavailable", "WDO reports could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 64_000));
    const { client, activeOrganization, user } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_wdo_inspections")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        property_id: payload.propertyId,
        work_order_id: payload.workOrderId ?? null,
        inspector_technician_id: payload.inspectorTechnicianId,
        report_number: payload.reportNumber,
        inspected_on: payload.inspectedOn ?? undefined,
        structures_inspected: payload.structuresInspected,
        visible_evidence: payload.visibleEvidence,
        obstructions: payload.obstructions ?? null,
        inaccessible_areas: payload.inaccessibleAreas ?? null,
        recommendation: payload.recommendation ?? null,
        diagram_kind: payload.diagramKind,
        supersedes_id: payload.supersedesId ?? null,
        created_by: user.id,
      } as never)
      .select(CRM_WDO_INSPECTION_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "report_number_taken",
              message: "A report already carries that number.",
            },
          },
          { status: 409 },
        );
      }
      throw error;
    }

    return jsonNoStore(
      { inspection: toWdoInspectionView(data as unknown as CrmWdoInspectionRow) },
      { status: 201 },
    );
  } catch (error) {
    return failure(
      error, "invalid_wdo_inspection", "wdo_not_created", "That report could not be started.",
    );
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
