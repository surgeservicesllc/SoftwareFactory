import { z } from "zod";

import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

const paramsSchema = z.object({ documentId: z.string().uuid() });

/**
 * One filed copy, as the file it is (ADR-222).
 *
 * The projection returns the row only when it belongs to the caller's own
 * account; anybody else's id comes back empty, which is deliberately the
 * same answer as "no such document".
 *
 * Served as an attachment with the content type the filing recorded —
 * text/html or text/plain, nothing else, because ADR-216's schema refuses
 * a content type this repository cannot actually produce.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "portal_filed_document_invalid", message: "That is not a document id." } },
        { status: 400 },
      );
    }

    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_filed_document_body", {
      p_document: parsed.data.documentId,
    });
    if (error) throw error;

    const row = (data as { title: string; content_type: string; body: string }[] | null)?.[0];
    if (row === undefined) {
      return jsonNoStore(
        { error: { code: "portal_filed_document_missing", message: "No such document." } },
        { status: 404 },
      );
    }

    // The filename keeps the filing's own title, made safe for the header.
    const extension = row.content_type === "text/html" ? "html" : "txt";
    const filename = `${row.title.replace(/[^A-Za-z0-9 ._-]/g, "").trim().slice(0, 80) || "document"}.${extension}`;

    return new Response(row.body, {
      status: 200,
      headers: {
        "content-type": `${row.content_type}; charset=utf-8`,
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        // The body is customer paperwork rendered from stored HTML; serving
        // it as a download (never inline) keeps it out of this origin's DOM.
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return portalErrorResponse(
      error,
      "portal_filed_document_unavailable",
      "That document could not be loaded.",
    );
  }
}
