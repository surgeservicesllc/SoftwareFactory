import { z } from "zod";

import { reportDetailSchema } from "@/lib/server/control-plane-detail-schemas";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { safeDetailProjection, tenantRpcDetailResponse } from "@/lib/server/tenant-detail";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * One report: read it, archive or restore it, or delete it.
 *
 * The two verbs are not synonyms and the difference is the whole design.
 * PATCH moves the report between the `archived` status and the one it held
 * before — reversible, owner or administrator, nothing destroyed. DELETE
 * removes the row, and is owner-only with a required reason recorded before
 * the row goes.
 *
 * Deletion is genuinely available here in a way it is not for projects or run
 * evidence: nothing in the schema references `reports`, so a deleted report
 * orphans nothing. That is why this route offers a real delete while the
 * project routes offer archive and say why they cannot offer more.
 */

const archiveSchema = z.object({
  archived: z.boolean(),
  reason: z.string().trim().max(400).optional(),
}).strict();

const deleteSchema = z.object({
  reason: z.string().trim().min(10).max(400),
}).strict();

function invalidReportId() {
  return jsonNoStore(
    { error: { code: "invalid_report_id", message: "The report identifier is invalid." } },
    { status: 400 },
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return tenantRpcDetailResponse<Record<string, unknown>, unknown>({
    id: reportId,
    idParameter: "p_report_id",
    itemKey: "report",
    rpc: "get_report_detail",
    unavailableCode: "report_unavailable",
    unavailableMessage: "Report details could not be loaded.",
    shape: (row) => reportDetailSchema.parse(safeDetailProjection(row)),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { reportId } = await params;
    if (!z.string().uuid().safeParse(reportId).success) return invalidReportId();

    const parsed = archiveSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_report_archive",
            message: "Specify whether to archive or restore the report.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (!["owner", "admin"].includes(activeOrganization.role)) {
      return jsonNoStore(
        {
          error: {
            code: "report_archive_forbidden",
            message: "Organization owner or administrator access is required.",
          },
        },
        { status: 403 },
      );
    }

    const { data, error } = await client.rpc("set_report_archived", {
      p_archived: parsed.data.archived,
      p_organization_id: activeOrganization.id,
      p_reason: parsed.data.reason ?? null,
      p_report_id: reportId,
    });
    if (error) return databaseErrorResponse(error);

    const row = (Array.isArray(data) ? data[0] : data) as
      | { report_id: string; status: string }
      | null;
    if (!row) {
      return jsonNoStore(
        { error: { code: "report_not_found", message: "The report is not available." } },
        { status: 404 },
      );
    }

    return jsonNoStore({ report: { id: row.report_id, status: row.status } });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "internal_error", message: "The report could not be updated." } },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { reportId } = await params;
    if (!z.string().uuid().safeParse(reportId).success) return invalidReportId();

    const parsed = deleteSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_report_deletion",
            message: "A reason of at least ten characters is required to delete a report.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (activeOrganization.role !== "owner") {
      return jsonNoStore(
        {
          error: {
            code: "report_deletion_forbidden",
            message: "Only an organization owner may delete a report.",
          },
        },
        { status: 403 },
      );
    }

    const { data, error } = await client.rpc("delete_report", {
      p_organization_id: activeOrganization.id,
      p_reason: parsed.data.reason,
      p_report_id: reportId,
    });
    if (error) return databaseErrorResponse(error);

    const row = (Array.isArray(data) ? data[0] : data) as
      | { deleted_report_id: string }
      | null;
    if (!row) {
      return jsonNoStore(
        { error: { code: "report_not_found", message: "The report is not available." } },
        { status: 404 },
      );
    }

    return jsonNoStore({ deleted: { reportId: row.deleted_report_id } });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "internal_error", message: "The report could not be deleted." } },
      { status: 500 },
    );
  }
}
