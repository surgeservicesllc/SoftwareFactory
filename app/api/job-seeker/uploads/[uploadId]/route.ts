import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/** Streams a stored upload back to its owner; RLS scopes the read. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  try {
    const { uploadId } = await params;
    if (!z.string().uuid().safeParse(uploadId).success) {
      throw new ApiRequestError(400, "invalid_upload", "The upload id is not valid.");
    }
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_uploads")
      .select("filename, content_type, data")
      .eq("organization_id", activeOrganization.id)
      .eq("id", uploadId)
      .maybeSingle<{ filename: string; content_type: string; data: string }>();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "upload_not_found", message: "The upload does not exist or is not yours." } },
        { status: 404 },
      );
    }
    // PostgREST returns bytea hex-encoded as \x....
    const hex = data.data.startsWith("\\x") ? data.data.slice(2) : data.data;
    const bytes = Buffer.from(hex, "hex");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": data.content_type,
        "Content-Disposition": `attachment; filename="${data.filename.replaceAll('"', "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_upload_unavailable", message: "The file could not be read." } },
      { status: 500 },
    );
  }
}
