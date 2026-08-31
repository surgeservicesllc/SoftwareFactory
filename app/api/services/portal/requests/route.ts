import { z } from "zod";

import {
  CRM_PORTAL_REQUEST_COLUMNS,
  CRM_REQUEST_STATUSES,
  isClosedRequestStatus,
  toPortalRequestView,
  type CrmPortalRequestRow,
  type CrmRequestStatus,
} from "@/lib/services/crm";
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
 * Staff triage of what customers sent in.
 *
 * Only `status`, `response` and the work order a request turned into are
 * writable. The customer's own `summary` and `detail` are not in the patch
 * schema at all: their words are theirs, and the company's answer goes in
 * its own column beside them.
 */

const patchSchema = z
  .object({
    requestId: z.string().uuid(),
    status: z.enum(CRM_REQUEST_STATUSES as unknown as [string, ...string[]]).optional(),
    response: z.string().trim().min(1).max(4000).nullable().optional(),
    workOrderId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const status = new URL(request.url).searchParams.get("status");

    let query = client
      .from("crm_portal_requests")
      .select(CRM_PORTAL_REQUEST_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("submitted_at", { ascending: false })
      .limit(500);
    if (status !== null && (CRM_REQUEST_STATUSES as readonly string[]).includes(status)) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) return databaseErrorResponse(error);

    const requests = ((data ?? []) as unknown as CrmPortalRequestRow[]).map(toPortalRequestView);
    const open = requests.filter((row) => row.open);

    return jsonNoStore({
      requests,
      counts: {
        total: requests.length,
        open: open.length,
        /*
         * Open requests nobody has written back to. This is the queue —
         * the count that says how many customers are waiting on a human,
         * rather than how many rows exist.
         */
        awaitingReply: open.filter((row) => !row.answered).length,
        byStatus: Object.fromEntries(
          CRM_REQUEST_STATUSES.map((value) => [value, requests.filter((row) => row.status === value).length]),
        ),
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_portal_requests_unavailable", message: "Service requests could not be listed." } },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.response !== undefined) changes.response = payload.response;
    if (payload.workOrderId !== undefined) changes.work_order_id = payload.workOrderId;
    if (payload.status !== undefined) {
      changes.status = payload.status;
      /*
       * The schema will not hold a closed request without the moment it
       * closed, or an open one that carries such a moment. Stating both
       * here keeps the caller from having to remember the pairing.
       */
      changes.resolved_at = isClosedRequestStatus(payload.status as CrmRequestStatus)
        ? new Date().toISOString()
        : null;
    }

    const { data, error } = await client
      .from("crm_portal_requests")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.requestId)
      .select(CRM_PORTAL_REQUEST_COLUMNS)
      .maybeSingle();
    if (error) return requestWriteError(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "portal_request_not_found", message: "No such request in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ request: toPortalRequestView(data as unknown as CrmPortalRequestRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_portal_request_change",
            message: error.issues[0]?.message ?? "The request could not be updated.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_portal_request_not_updated", message: "The request could not be updated." } },
      { status: 500 },
    );
  }
}

function requestWriteError(error: { code?: string }) {
  if (error.code === "23503") {
    return jsonNoStore(
      { error: { code: "reference_not_found", message: "That work order is not in this workspace." } },
      { status: 404 },
    );
  }
  if (error.code === "23514") {
    return jsonNoStore(
      {
        error: {
          code: "portal_request_refused",
          message:
            "The record was refused — a closed request needs the moment it closed, and text may not carry a secret.",
        },
      },
      { status: 409 },
    );
  }
  return databaseErrorResponse(error as Parameters<typeof databaseErrorResponse>[0]);
}
