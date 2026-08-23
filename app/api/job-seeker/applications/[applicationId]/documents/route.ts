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
  type JobForDocuments,
  type ProfileForDocuments,
} from "@/lib/job-seeker/documents";
import { VERIFICATION_METHOD_LABEL, verifyDocument } from "@/lib/job-seeker/verification";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The application workspace's documents: generated from the recorded career
 * profile ONLY (there is no model in this path — nothing can fabricate),
 * stored as immutable versions, and the application moves to
 * READY_FOR_REVIEW so the person's approval is the next gate.
 *
 * Each version travels with its verification: what an applicant tracking
 * system will read out of it, which of the posting's terms it covers, and
 * whether every figure in it traces to a recorded fact. The verification is
 * COMPUTED, never stored. It is a pure function of the document and the
 * profile, both of which are already stored, so a stored copy would go stale
 * the moment either changed — and a stale "verified" badge is worse than
 * none. Computing it on read means it always describes the version in hand.
 */

type DocumentRow = {
  id: string;
  kind: string;
  version: number;
  content: string;
  created_at: string;
};

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

function toView(
  row: DocumentRow,
  context: Readonly<{ profile: ProfileForDocuments; job: JobForDocuments }> | null,
) {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    content: row.content,
    createdAt: row.created_at,
    /*
     * Null, not a passing verification, when the profile or job could not be
     * read. "We could not check this" and "this checks out" are different
     * answers, and only one of them is safe to render as a green badge.
     */
    verification: context
      ? verifyDocument({
        content: row.content,
        kind: row.kind as "resume" | "cover_letter" | "answers",
        profile: context.profile,
        job: context.job,
      })
      : null,
  };
}

type QueryClient = Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>;

/**
 * The facts a verification is measured against. Returns null rather than a
 * partial context: verifying a resume against half a profile would report
 * a missing email that is recorded, which is a false finding, not a lenient
 * one.
 */
async function loadVerificationContext(
  client: QueryClient,
  organizationId: string,
  jobId: string | null,
): Promise<Readonly<{ profile: ProfileForDocuments; job: JobForDocuments }> | null> {
  if (!jobId) return null;
  const [{ data: profileRow }, { data: jobRow }] = await Promise.all([
    client
      .from("job_seeker_profiles")
      .select(PROFILE_COLUMNS)
      .eq("organization_id", organizationId)
      .maybeSingle<ProfileRow>(),
    client
      .from("job_seeker_jobs")
      .select("title, company, description")
      .eq("id", jobId)
      .maybeSingle<{ title: string; company: string; description: string | null }>(),
  ]);
  if (!profileRow || !jobRow) return null;
  return { profile: toProfile(profileRow), job: jobRow };
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
    const [{ data, error }, { data: application }] = await Promise.all([
      client
        .from("job_seeker_documents")
        .select("id, kind, version, content, created_at")
        .eq("organization_id", activeOrganization.id)
        .eq("application_id", applicationId)
        .order("version", { ascending: false })
        .order("kind"),
      client
        .from("job_seeker_applications")
        .select("job_id")
        .eq("organization_id", activeOrganization.id)
        .eq("id", applicationId)
        .maybeSingle<{ job_id: string }>(),
    ]);
    if (error) return databaseErrorResponse(error);

    const context = await loadVerificationContext(client, activeOrganization.id, application?.job_id ?? null);
    return jsonNoStore({
      documents: ((data ?? []) as DocumentRow[]).map((row) => toView(row, context)),
      verificationMethod: VERIFICATION_METHOD_LABEL,
    });
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
          .select(PROFILE_COLUMNS)
          .eq("organization_id", activeOrganization.id)
          .maybeSingle<ProfileRow>(),
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

    const profile = toProfile(profileRow);
    const job: JobForDocuments = {
      title: jobRow.title,
      company: jobRow.company,
      description: jobRow.description,
    };

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
      {
        documents: ((documents ?? []) as DocumentRow[]).map((row) => toView(row, { profile, job })),
        verificationMethod: VERIFICATION_METHOD_LABEL,
      },
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
