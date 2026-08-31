import { z } from "zod";

import {
  CRM_CONTENT_TYPE_PATTERN,
  CRM_DOCUMENT_COLUMNS,
  CRM_DOCUMENT_KINDS,
  isStoragePath,
  toDocumentView,
  type CrmDocumentRow,
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
 * Documents: what was filed, where it lives, and what it is about.
 *
 * The bytes never come through here and never enter the database. A row is
 * a private storage path plus its metadata, and the path is CHECKed to be a
 * path rather than a link — a public URL stored as a document reference
 * would be an access-control hole wearing a column name. Whatever renders a
 * document asks storage for a signed URL, which is where the access check
 * belongs.
 */

const createSchema = z
  .object({
    accountId: z.string().uuid().nullish(),
    propertyId: z.string().uuid().nullish(),
    workOrderId: z.string().uuid().nullish(),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(CRM_DOCUMENT_KINDS).default("other"),
    storagePath: z
      .string()
      .trim()
      .refine(isStoragePath, "A private storage path — not a URL."),
    contentType: z
      .string()
      .trim()
      .regex(CRM_CONTENT_TYPE_PATTERN, "A media type, like image/jpeg.")
      .nullish(),
    byteSize: z.number().int().positive().max(5_368_709_120).nullish(),
    notes: z.string().trim().min(1).max(4000).nullish(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.accountId ?? value.propertyId ?? value.workOrderId),
    { message: "A document is filed about a customer, a site or a visit." },
  );

const patchSchema = z
  .object({
    documentId: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    kind: z.enum(CRM_DOCUMENT_KINDS).optional(),
    notes: z.string().trim().min(1).max(4000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId");

    let query = client
      .from("crm_documents")
      .select(CRM_DOCUMENT_COLUMNS)
      .eq("organization_id", activeOrganization.id);
    if (accountId !== null && accountId !== "") query = query.eq("account_id", accountId);

    const { data, error } = await query.order("uploaded_at", { ascending: false }).limit(400);
    if (error) return databaseErrorResponse(error);

    const documents = ((data ?? []) as unknown as CrmDocumentRow[]).map(toDocumentView);
    const byKind: Record<string, number> = {};
    for (const document of documents) byKind[document.kind] = (byKind[document.kind] ?? 0) + 1;
    return jsonNoStore({
      documents,
      counts: {
        total: documents.length,
        byKind,
        bytes: documents.reduce((sum, document) => sum + (document.byteSize ?? 0), 0),
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_documents_unavailable", message: "Documents could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_documents")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId ?? null,
        property_id: payload.propertyId ?? null,
        work_order_id: payload.workOrderId ?? null,
        title: payload.title,
        kind: payload.kind,
        storage_path: payload.storagePath,
        content_type: payload.contentType ?? null,
        byte_size: payload.byteSize ?? null,
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_DOCUMENT_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "document_path_taken",
              message: "A document is already filed at that storage path.",
            },
          },
          { status: 409 },
        );
      }
      if (error.code === "23503") {
        return jsonNoStore(
          {
            error: {
              code: "reference_not_found",
              message:
                "The customer, site or visit is not in this workspace — and the site must belong to the customer.",
            },
          },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ document: toDocumentView(data as unknown as CrmDocumentRow) }, { status: 201 });
  } catch (error) {
    return failure(error, "invalid_document", "crm_document_not_recorded", "The document could not be filed.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.title !== undefined) changes.title = payload.title;
    if (payload.kind !== undefined) changes.kind = payload.kind;
    if (payload.notes !== undefined) changes.notes = payload.notes;
    // The storage path is deliberately not editable: repointing a filed
    // document at a different object is filing a different document.

    const { data, error } = await client
      .from("crm_documents")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.documentId)
      .select(CRM_DOCUMENT_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "document_not_found", message: "No such document in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ document: toDocumentView(data as unknown as CrmDocumentRow) });
  } catch (error) {
    return failure(error, "invalid_document_change", "crm_document_not_updated", "The document could not be updated.");
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
