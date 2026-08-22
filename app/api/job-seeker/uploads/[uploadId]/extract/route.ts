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

import { extractResumeText } from "@/lib/job-seeker/resume-text";
import { reviewResume } from "@/lib/job-seeker/resume-review";
import { proposedFieldCount } from "@/lib/job-seeker/resume-extract";

export const runtime = "nodejs";
/**
 * Reading a PDF and calling a model is not a 10-second job on a cold start,
 * and the alternative to a longer budget is a timeout the person reads as
 * "my resume is broken".
 */
export const maxDuration = 120;

/**
 * Read an uploaded resume and propose profile fields from it.
 *
 * POST, not GET, because it creates a row and may call a provider — this is
 * not a cacheable read of an existing thing. What it does NOT do is change the
 * profile: the response is a proposal, and applying it is a second, explicit
 * request the person makes after seeing what was found.
 *
 * A file that cannot be read still records a row with status `failed` and the
 * reason. That is deliberate: "we tried and here is what went wrong" is a
 * different thing from a button that appears to do nothing, and the row is
 * what lets the surface say which of the two happened.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { uploadId } = await params;
    if (!z.string().uuid().safeParse(uploadId).success) {
      throw new ApiRequestError(400, "invalid_upload", "The upload id is not valid.");
    }

    const { client, user, activeOrganization } = await requireActiveOrganization();
    const { data: upload, error: uploadError } = await client
      .from("job_seeker_uploads")
      .select("id, content_type, data")
      .eq("organization_id", activeOrganization.id)
      .eq("id", uploadId)
      .maybeSingle<{ id: string; content_type: string; data: string }>();
    if (uploadError) return databaseErrorResponse(uploadError);
    if (!upload) {
      return jsonNoStore(
        { error: { code: "upload_not_found", message: "The upload does not exist or is not yours." } },
        { status: 404 },
      );
    }

    // PostgREST returns bytea hex-encoded as \x....
    const hex = upload.data.startsWith("\\x") ? upload.data.slice(2) : upload.data;
    const bytes = Buffer.from(hex, "hex");

    const text = await extractResumeText(bytes, upload.content_type);
    if (!text.ok) {
      const failure = {
        organization_id: activeOrganization.id,
        user_id: user.id,
        upload_id: upload.id,
        status: "failed" as const,
        model: null,
        detail: text.message,
        proposal: {},
        sources: {},
        character_count: 0,
        truncated: false,
      };
      const { data: row, error } = await client
        .from("job_seeker_resume_extractions")
        .insert(failure)
        .select("id, created_at")
        .single<{ id: string; created_at: string }>();
      if (error) return databaseErrorResponse(error);

      // 200, not an error status: the request was handled correctly and the
      // answer is "this file has no readable text". A 4xx or 5xx here would
      // read as a broken endpoint rather than a scanned document.
      return jsonNoStore({
        extraction: {
          id: row.id,
          status: "failed",
          model: null,
          detail: text.message,
          reason: text.code,
          proposal: {},
          sources: {},
          proposedFieldCount: 0,
          characterCount: 0,
          truncated: false,
          appliedAt: null,
          createdAt: row.created_at,
        },
      });
    }

    const review = await reviewResume(text.text);
    const { data: row, error } = await client
      .from("job_seeker_resume_extractions")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        upload_id: upload.id,
        status: review.status,
        model: review.model,
        detail: review.detail.slice(0, 2000),
        proposal: review.proposal,
        sources: review.sources,
        character_count: text.characters,
        truncated: text.truncated,
      })
      .select("id, created_at")
      .single<{ id: string; created_at: string }>();
    if (error) return databaseErrorResponse(error);

    return jsonNoStore(
      {
        extraction: {
          id: row.id,
          status: review.status,
          model: review.model,
          detail: review.detail,
          proposal: review.proposal,
          sources: review.sources,
          proposedFieldCount: proposedFieldCount(review.proposal),
          characterCount: text.characters,
          truncated: text.truncated,
          appliedAt: null,
          createdAt: row.created_at,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      {
        error: {
          code: "resume_extraction_unavailable",
          message: "The resume could not be read just now.",
        },
      },
      { status: 500 },
    );
  }
}

/** The most recent reading of this upload, so a reload does not re-run it. */
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
      .from("job_seeker_resume_extractions")
      .select("id, status, model, detail, proposal, sources, character_count, truncated, applied_at, applied_fields, created_at")
      .eq("organization_id", activeOrganization.id)
      .eq("upload_id", uploadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        status: string;
        model: string | null;
        detail: string;
        proposal: Record<string, unknown>;
        sources: Record<string, string>;
        character_count: number;
        truncated: boolean;
        applied_at: string | null;
        applied_fields: string[];
        created_at: string;
      }>();
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      extraction: data
        ? {
          id: data.id,
          status: data.status,
          model: data.model,
          detail: data.detail,
          proposal: data.proposal,
          sources: data.sources,
          proposedFieldCount: proposedFieldCount(data.proposal as never),
          characterCount: data.character_count,
          truncated: data.truncated,
          appliedAt: data.applied_at,
          appliedFields: data.applied_fields,
          createdAt: data.created_at,
        }
        : null,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      {
        error: {
          code: "resume_extraction_unavailable",
          message: "The resume reading could not be loaded.",
        },
      },
      { status: 500 },
    );
  }
}
