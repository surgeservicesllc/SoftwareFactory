import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Resume/document upload, stored in the person-scoped BYTEA table under the
 * same RLS as every other job_seeker_* row (see migration 20260820000300 for
 * why not Supabase Storage: its policies cannot be provisioned through this
 * repository's apply path, and the web tier deliberately holds no
 * service-role key that could bypass them). 2 MB cap, allowlisted types.
 */

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);
const MAX_BYTES = 2_097_152;

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const form = await request.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "resume");
    if (!(file instanceof File)) {
      throw new ApiRequestError(422, "file_required", "Attach a file field named 'file'.");
    }
    if (!z.enum(["resume", "document"]).safeParse(kind).success) {
      throw new ApiRequestError(422, "invalid_kind", "kind must be 'resume' or 'document'.");
    }
    const contentType = file.type || "text/plain";
    if (!ALLOWED_TYPES.has(contentType)) {
      throw new ApiRequestError(
        415,
        "unsupported_file_type",
        "Upload a PDF, DOCX, plain-text, or Markdown file.",
      );
    }
    if (file.size < 1 || file.size > MAX_BYTES) {
      throw new ApiRequestError(413, "file_too_large", "The file must be between 1 byte and 2 MB.");
    }
    const filename = (file.name || "resume").slice(0, 200);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) {
      throw new ApiRequestError(413, "file_too_large", "The file must be at most 2 MB.");
    }

    const { client, user, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_uploads")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        kind,
        filename,
        content_type: contentType,
        byte_size: bytes.byteLength,
        data: `\\x${bytes.toString("hex")}`,
      })
      .select("id, kind, filename, content_type, byte_size, created_at")
      .single<{ id: string; kind: string; filename: string; content_type: string; byte_size: number; created_at: string }>();
    if (error) return databaseErrorResponse(error);

    if (kind === "resume") {
      // The newest resume becomes the profile's current one; the pointer is
      // created with the profile row when none exists yet.
      const { error: pointerError } = await client
        .from("job_seeker_profiles")
        .upsert(
          { organization_id: activeOrganization.id, user_id: user.id, resume_upload_id: data.id },
          { onConflict: "organization_id,user_id" },
        );
      if (pointerError) return databaseErrorResponse(pointerError);
    }

    return jsonNoStore(
      {
        upload: {
          id: data.id,
          kind: data.kind,
          filename: data.filename,
          contentType: data.content_type,
          byteSize: data.byte_size,
          createdAt: data.created_at,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_upload_unavailable", message: "The file could not be uploaded." } },
      { status: 500 },
    );
  }
}
