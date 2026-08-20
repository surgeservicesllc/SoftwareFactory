import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import {
  buildAtsResume,
  buildCoverLetter,
  type ProfileForDocuments,
} from "@/lib/job-seeker/documents";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The application workspace's documents: generated from the recorded career
 * profile ONLY (there is no model in this path — nothing can fabricate),
 * stored as immutable versions, and the application moves to
 * READY_FOR_REVIEW so the person's approval is the next gate.
 */

type DocumentRow = {
  id: string;
  kind: string;
  version: number;
  content: string;
  created_at: string;
};

function toView(row: DocumentRow) {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params;
    if (!z.string().uuid().safeParse(applicationId).success) {
      throw new ApiRequestError(400, "invalid_application", "The application id is not valid.");
    }
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_documents")
      .select("id, kind, version, content, created_at")
      .eq("organization_id", activeOrganization.id)
      .eq("application_id", applicationId)
      .order("version", { ascending: false })
      .order("kind");
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ documents: ((data ?? []) as DocumentRow[]).map(toView) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_documents_unavailable", message: "Documents could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { applicationId } = await params;
    if (!z.string().uuid().safeParse(applicationId).success) {
      throw new ApiRequestError(400, "invalid_application", "The application id is not valid.");
    }
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data: application, error: applicationError } = await client
      .from("job_seeker_applications")
      .select("id, job_id, stage")
      .eq("organization_id", activeOrganization.id)
      .eq("id", applicationId)
      .maybeSingle<{ id: string; job_id: string; stage: string }>();
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
          .select("full_name, email, phone, linkedin_url, location, summary, skills, technologies, certifications, employment_history, education")
          .eq("organization_id", activeOrganization.id)
          .maybeSingle(),
        client
          .from("job_seeker_jobs")
          .select("title, company, description")
          .eq("id", application.job_id)
          .single<{ title: string; company: string; description: string | null }>(),
      ]);
    if (profileError) return databaseErrorResponse(profileError);
    if (jobError) return databaseErrorResponse(jobError);
    if (!profileRow) {
      return jsonNoStore(
        {
          error: {
            code: "profile_required",
            message: "Documents are generated from your career profile only, and no profile is recorded yet. Complete it first.",
          },
        },
        { status: 409 },
      );
    }

    const profile: ProfileForDocuments = {
      fullName: profileRow.full_name,
      email: profileRow.email,
      phone: profileRow.phone,
      linkedinUrl: profileRow.linkedin_url,
      location: profileRow.location,
      summary: profileRow.summary,
      skills: (profileRow.skills ?? []) as string[],
      technologies: (profileRow.technologies ?? []) as string[],
      certifications: (profileRow.certifications ?? []) as string[],
      employmentHistory: (profileRow.employment_history ?? []) as ProfileForDocuments["employmentHistory"],
      education: (profileRow.education ?? []) as ProfileForDocuments["education"],
    };
    const job = { title: jobRow.title, company: jobRow.company, description: jobRow.description };

    // Next version = one past the highest stored, per kind.
    const { data: versionRows, error: versionError } = await client
      .from("job_seeker_documents")
      .select("kind, version")
      .eq("application_id", applicationId)
      .order("version", { ascending: false });
    if (versionError) return databaseErrorResponse(versionError);
    const nextVersion = (kind: string) =>
      ((versionRows ?? []).find((row) => row.kind === kind)?.version ?? 0) + 1;

    const { error: insertError } = await client.from("job_seeker_documents").insert([
      {
        organization_id: activeOrganization.id,
        user_id: user.id,
        application_id: applicationId,
        kind: "resume",
        version: nextVersion("resume"),
        content: buildAtsResume(profile, job),
      },
      {
        organization_id: activeOrganization.id,
        user_id: user.id,
        application_id: applicationId,
        kind: "cover_letter",
        version: nextVersion("cover_letter"),
        content: buildCoverLetter(profile, job),
      },
    ]);
    if (insertError) return databaseErrorResponse(insertError);

    // The pipeline's honest transition: documents exist, so the application
    // is ready for the person's review. Pre-approval stages only; the gate
    // stays untouched.
    if (["FOUND", "QUALIFIED", "RESUME_CREATED"].includes(application.stage)) {
      const { error: stageError } = await client
        .from("job_seeker_applications")
        .update({ stage: "READY_FOR_REVIEW" })
        .eq("id", applicationId);
      if (stageError) return databaseErrorResponse(stageError);
    }

    const { data: documents, error: listError } = await client
      .from("job_seeker_documents")
      .select("id, kind, version, content, created_at")
      .eq("application_id", applicationId)
      .order("version", { ascending: false })
      .order("kind");
    if (listError) return databaseErrorResponse(listError);
    return jsonNoStore(
      { documents: ((documents ?? []) as DocumentRow[]).map(toView) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_documents_unavailable", message: "Documents could not be generated." } },
      { status: 500 },
    );
  }
}
