import { jsonNoStore } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

type FiledRow = {
  id: string;
  kind: string;
  title: string;
  content_type: string;
  byte_size: number;
  filed_at: string;
  superseded: boolean;
};

/**
 * The customer's FILED copies (ADR-216 via ADR-222): frozen bytes, each one
 * exactly what the report said on the day it was filed. Unlike the
 * metadata-only uploads list, every row here can actually be downloaded —
 * the bytes live in a column under RLS, and no object storage is involved.
 *
 * A superseded filing stays in the list and says so, because the customer
 * may be holding a printed copy of the old one and needs to see that a
 * correction exists.
 */
export async function GET() {
  try {
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_filed_documents");
    if (error) throw error;

    const documents = ((data ?? []) as FiledRow[]).map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      contentType: row.content_type,
      byteSize: Number(row.byte_size),
      filedAt: row.filed_at,
      superseded: row.superseded,
    }));

    return jsonNoStore({ documents, counts: { total: documents.length } });
  } catch (error) {
    return portalErrorResponse(
      error,
      "portal_filed_documents_unavailable",
      "Your filed copies could not be loaded.",
    );
  }
}
