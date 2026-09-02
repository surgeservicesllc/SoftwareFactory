import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { toKitProfile } from "@/app/api/job-seeker/application-kit/route";
import { toScreeningAnswers, type KitProfile } from "@/lib/job-seeker/application-kit";
import { deriveSeniority } from "@/lib/job-seeker/board-search/unify";
import type { WorkModel } from "@/lib/job-seeker/board-search/signals";
import { buildPrepSheet, type PrepContact, type PrepJob, type PrepSheet } from "@/lib/job-seeker/interview-prep";
import { generateInterviewQuestions, modelQuestionsAvailability } from "@/lib/job-seeker/interview-questions";
import { loadRecordedPostings } from "@/lib/job-seeker/record";
import { companyMemory } from "@/lib/job-seeker/what-costs";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The interview prep sheet for one recorded job (ADR-246).
 *
 * GET composes the sheet from the person's own rows — profile, screening
 * answers, the application and its contacts, their history with the
 * company — and the posting's own text. Nothing in it is generated, and
 * a page open never calls a provider. POST asks the model for likely
 * questions, on demand, and answers **Not Connected** with the reason
 * when no usable provider credential exists on the server.
 */

const EMPTY_PROFILE: KitProfile = {
  fullName: null, email: null, phone: null, linkedinUrl: null, location: null, summary: null,
  skills: [], technologies: [], certifications: [], employmentHistory: [], education: [],
};

type Embed<T> = T | T[] | null | undefined;
function firstEmbed<T>(value: Embed<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type JobRow = {
  id: string;
  title: string;
  company: string;
  description: string | null;
  salary_text: string | null;
  location: string | null;
  work_model: WorkModel | null;
  job_seeker_applications: Embed<{ id: string; stage: string; notes: string | null; follow_up_at: string | null; applied_at: string | null }>;
};

type Composed = Readonly<{ jobId: string; job: PrepJob; sheet: PrepSheet; profileRecorded: boolean }>;

async function compose(jobId: string): Promise<Composed | Response> {
  if (!z.string().uuid().safeParse(jobId).success) {
    throw new ApiRequestError(400, "invalid_job", "The job id is not valid.");
  }
  const { client, activeOrganization } = await requireActiveOrganization();
  const { data: row, error: jobError } = await client
    .from("job_seeker_jobs")
    .select("id, title, company, description, salary_text, location, work_model, job_seeker_applications ( id, stage, notes, follow_up_at, applied_at )")
    .eq("organization_id", activeOrganization.id)
    .eq("id", jobId)
    .maybeSingle<JobRow>();
  if (jobError) return databaseErrorResponse(jobError);
  if (!row) {
    return jsonNoStore(
      { error: { code: "job_not_found", message: "The job does not exist or is not yours." } },
      { status: 404 },
    );
  }
  const application = firstEmbed(row.job_seeker_applications);
  const [{ data: profileRow, error: profileError }, { data: answerRows, error: answersError }, contactsResult, recorded] =
    await Promise.all([
      client
        .from("job_seeker_profiles")
        .select("full_name, email, phone, linkedin_url, location, summary, skills, technologies, certifications, employment_history, education")
        .eq("organization_id", activeOrganization.id)
        .maybeSingle<Parameters<typeof toKitProfile>[0]>(),
      client.from("job_seeker_screening_answers").select("question_key, answer").eq("organization_id", activeOrganization.id),
      application === null
        ? Promise.resolve({ data: [] as PrepContact[], error: null })
        : client
            .from("job_seeker_contacts")
            .select("name, role, source")
            .eq("organization_id", activeOrganization.id)
            .eq("application_id", application.id)
            .order("created_at", { ascending: true }),
      loadRecordedPostings(client, activeOrganization.id),
    ]);
  if (profileError) return databaseErrorResponse(profileError);
  if (answersError) return databaseErrorResponse(answersError);
  if (contactsResult.error) return databaseErrorResponse(contactsResult.error);

  const job: PrepJob = {
    title: row.title,
    company: row.company,
    description: row.description,
    salaryText: row.salary_text,
    location: row.location,
    workModel: row.work_model,
    // Recorded jobs keep no posting date; the sheet asks no question about it.
    publishedOn: null,
  };
  const profile = profileRow === null ? EMPTY_PROFILE : toKitProfile(profileRow);
  const sheet = buildPrepSheet({
    job,
    titleStatesLevel: deriveSeniority(row.title) !== null,
    profile,
    answers: toScreeningAnswers((answerRows ?? []) as Array<{ question_key: string; answer: string }>),
    application: application === null
      ? null
      : { stage: application.stage, notes: application.notes, appliedAt: application.applied_at, followUpAt: application.follow_up_at },
    contacts: ((contactsResult.data ?? []) as Array<{ name: string; role: string | null; source: string | null }>).map((contact) => ({
      name: contact.name,
      role: contact.role,
      source: contact.source,
    })),
    memory: recorded === null ? null : companyMemory(recorded, row.company),
  });
  return { jobId: row.id, job, sheet, profileRecorded: profileRow !== null };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const composed = await compose(jobId);
    if (composed instanceof Response) return composed;
    return jsonNoStore({
      jobId: composed.jobId,
      sheet: composed.sheet,
      profileRecorded: composed.profileRecorded,
      /** Whether the model lane is usable; the questions themselves come from POST, on request. */
      model: modelQuestionsAvailability(),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "prep_unavailable", message: "The prep sheet could not be composed." } },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { jobId } = await params;
    const composed = await compose(jobId);
    if (composed instanceof Response) return composed;
    const model = await generateInterviewQuestions({
      title: composed.job.title,
      company: composed.job.company,
      description: composed.job.description,
      strengths: composed.sheet.strengths.map((strength) => strength.term),
      gaps: composed.sheet.gaps.map((gap) => gap.term),
    });
    return jsonNoStore({ jobId: composed.jobId, model });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "prep_questions_unavailable", message: "The model questions could not be requested." } },
      { status: 500 },
    );
  }
}
