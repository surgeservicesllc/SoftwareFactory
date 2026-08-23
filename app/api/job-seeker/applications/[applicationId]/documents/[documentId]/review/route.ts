import { z } from "zod";

import {
  REVIEW_METHOD_LABEL,
  applyReviewEdits,
  reviewDocument,
  type ReviewEdit,
} from "@/lib/job-seeker/document-review";
import type { JobForDocuments, ProfileForDocuments } from "@/lib/job-seeker/documents";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Review one stored document version, and optionally revise it.
 *
 * POST with `{"apply": false}` records a critique and changes nothing.
 * POST with `{"apply": true}` records the same critique and then writes a NEW
 * document version carrying the edits that survived the grounding audit. The
 * old version is untouched — versions are immutable, which is what keeps
 * "which one did they actually send" answerable.
 *
 * Nothing here can make a document claim more than the profile supports. The
 * reviewer's instruction not to is a prompt; `applyReviewEdits` re-auditing
 * every edit against the recorded profile is the enforcement.
 */

const reviewSchema = z.object({ apply: z.boolean().default(false) }).strict();

const PROFILE_COLUMNS =
  "full_name, email, phone, linkedin_url, location, summary, skills, technologies, certifications, employment_history, education";

type ProfileRow = Readonly<{
  full_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  location: string | null;
  summary: string | null;
  skills: unknown;
  technologies: unknown;
  certifications: unknown;
  employment_history: unknown;
  education: unknown;
}>;

function toProfile(row: ProfileRow): ProfileForDocuments {
  return {
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    location: row.location,
    summary: row.summary,
    skills: (row.skills ?? []) as string[],
    technologies: (row.technologies ?? []) as string[],
    certifications: (row.certifications ?? []) as string[],
    employmentHistory: (row.employment_history ?? []) as ProfileForDocuments["employmentHistory"],
    education: (row.education ?? []) as ProfileForDocuments["education"],
  };
}

type DocumentKind = "resume" | "cover_letter" | "answers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ applicationId: string; documentId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { applicationId, documentId } = await params;
    for (const id of [applicationId, documentId]) {
      if (!z.string().uuid().safeParse(id).success) {
        throw new ApiRequestError(400, "invalid_identifier", "The identifier is not valid.");
      }
    }
    const { apply } = reviewSchema.parse(await readBoundedJson(request, 1024));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data: document, error: documentError } = await client
      .from("job_seeker_documents")
      .select("id, application_id, kind, version, content")
      .eq("organization_id", activeOrganization.id)
      .eq("application_id", applicationId)
      .eq("id", documentId)
      .maybeSingle<{
        id: string; application_id: string; kind: DocumentKind; version: number; content: string;
      }>();
    if (documentError) return databaseErrorResponse(documentError);
    if (!document) {
      return jsonNoStore(
        { error: { code: "document_not_found", message: "The document does not exist or is not yours." } },
        { status: 404 },
      );
    }

    const { data: application, error: applicationError } = await client
      .from("job_seeker_applications")
      .select("job_id")
      .eq("organization_id", activeOrganization.id)
      .eq("id", applicationId)
      .maybeSingle<{ job_id: string }>();
    if (applicationError) return databaseErrorResponse(applicationError);
    if (!application) {
      return jsonNoStore(
        { error: { code: "application_not_found", message: "The application does not exist or is not yours." } },
        { status: 404 },
      );
    }

    const [{ data: profileRow, error: profileError }, { data: jobRow, error: jobError }] =
      await Promise.all([
        client
          .from("job_seeker_profiles")
          .select(PROFILE_COLUMNS)
          .eq("organization_id", activeOrganization.id)
          .maybeSingle<ProfileRow>(),
        client
          .from("job_seeker_jobs")
          .select("title, company, description")
          .eq("id", application.job_id)
          .maybeSingle<{ title: string; company: string; description: string | null }>(),
      ]);
    if (profileError) return databaseErrorResponse(profileError);
    if (jobError) return databaseErrorResponse(jobError);
    if (!profileRow || !jobRow) {
      // Without the profile there is nothing to audit an edit against, and an
      // unaudited edit is exactly what must not be applied.
      return jsonNoStore(
        {
          error: {
            code: "review_context_missing",
            message: "A review is measured against your recorded profile and the posting, and one of them could not be read.",
          },
        },
        { status: 409 },
      );
    }

    const profile = toProfile(profileRow);
    const job: JobForDocuments = {
      title: jobRow.title,
      company: jobRow.company,
      description: jobRow.description,
    };

    const review = await reviewDocument({
      job, kind: document.kind, draft: document.content, profile,
    });

    /*
     * A model's output is third-party text on its way into the database. It
     * has no business carrying a credential-shaped value, and a review that
     * does is dropped rather than stored — the same rule imported postings
     * go through.
     */
    const safeEdits: ReviewEdit[] = review.edits.filter((edit) => !findSensitiveData(edit));
    const safeNarrative = review.narrative.filter((note) => !findSensitiveData(note));
    // Per entry, not all-or-nothing: one bad suggestion should not cost the
    // person the rest of a review that was fine.
    const scannerDropped = safeEdits.length !== review.edits.length
      || safeNarrative.length !== review.narrative.length;

    let revision: Awaited<ReturnType<typeof applyReviewEdits>> | null = null;
    let newVersion: number | null = null;

    if (apply && review.status === "reviewed" && safeEdits.length > 0) {
      revision = applyReviewEdits({
        content: document.content,
        edits: safeEdits,
        profile,
        job,
        // The posting grounds a cover letter's quoted figures and nothing
        // else; a resume's claims are the candidate's own.
        postingIsSource: document.kind === "cover_letter",
      });

      if (revision.applied.length > 0) {
        const { data: versionRows, error: versionError } = await client
          .from("job_seeker_documents")
          .select("version")
          .eq("application_id", applicationId)
          .eq("kind", document.kind)
          .order("version", { ascending: false })
          .limit(1);
        if (versionError) return databaseErrorResponse(versionError);
        newVersion = ((versionRows ?? [])[0]?.version ?? document.version) + 1;

        const { error: insertError } = await client.from("job_seeker_documents").insert({
          organization_id: activeOrganization.id,
          user_id: user.id,
          application_id: applicationId,
          kind: document.kind,
          version: newVersion,
          content: revision.content,
        });
        if (insertError) return databaseErrorResponse(insertError);
      }
    }

    const { data: reviewRow, error: reviewError } = await client
      .from("job_seeker_document_reviews")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        document_id: document.id,
        status: review.status,
        model: review.model,
        detail: review.detail,
        edits: safeEdits,
        narrative: safeNarrative,
        applied_at: revision && revision.applied.length > 0 ? new Date().toISOString() : null,
        applied_edit_count: revision?.applied.length ?? 0,
        rejected_edit_count: revision?.rejected.length ?? 0,
      })
      .select("id, created_at")
      .single<{ id: string; created_at: string }>();
    if (reviewError) return databaseErrorResponse(reviewError);

    return jsonNoStore(
      {
        review: {
          id: reviewRow.id,
          createdAt: reviewRow.created_at,
          documentId: document.id,
          status: review.status,
          model: review.model,
          detail: scannerDropped
            ? `${review.detail} Part of the review was dropped by the credential scanner.`
            : review.detail,
          edits: safeEdits,
          narrative: safeNarrative,
          applied: revision?.applied ?? [],
          rejected: revision?.rejected ?? [],
          newVersion,
        },
        method: REVIEW_METHOD_LABEL,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_review", message: "Say whether to apply the review." } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    if (error && typeof error === "object" && "code" in error && "message" in error) {
      return databaseErrorResponse(error as { code: string; message: string });
    }
    return jsonNoStore(
      { error: { code: "review_failed", message: "The review could not be completed." } },
      { status: 500 },
    );
  }
}
