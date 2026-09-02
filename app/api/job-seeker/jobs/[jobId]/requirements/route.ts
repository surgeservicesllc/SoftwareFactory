import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  requestErrorResponse,
} from "@/lib/server/http";
import { toKitProfile } from "@/app/api/job-seeker/application-kit/route";
import {
  checkRequirements,
  extractRequirements,
  toScreeningAnswers,
} from "@/lib/job-seeker/application-kit";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * A posting's stated requirements checked against the person's recorded
 * facts (ADR-244). Each line gets a verdict that names the fact it used —
 * or says that no recorded fact can answer it. Nothing is guessed to be
 * met: knockout screening questions are the leading cause of silent
 * rejection, and the honest answer to "do I meet this?" is sometimes
 * "you have not told me".
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    if (!z.string().uuid().safeParse(jobId).success) {
      throw new ApiRequestError(400, "invalid_job", "The job id is not valid.");
    }
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data: job, error: jobError } = await client
      .from("job_seeker_jobs")
      .select("id, title, company, description")
      .eq("organization_id", activeOrganization.id)
      .eq("id", jobId)
      .maybeSingle<{ id: string; title: string; company: string; description: string | null }>();
    if (jobError) return databaseErrorResponse(jobError);
    if (!job) {
      return jsonNoStore(
        { error: { code: "job_not_found", message: "The job does not exist or is not yours." } },
        { status: 404 },
      );
    }
    const [{ data: profileRow, error: profileError }, { data: answerRows, error: answersError }] = await Promise.all([
      client
        .from("job_seeker_profiles")
        .select("full_name, email, phone, linkedin_url, location, summary, skills, technologies, certifications, employment_history, education")
        .eq("organization_id", activeOrganization.id)
        .maybeSingle<Parameters<typeof toKitProfile>[0]>(),
      client.from("job_seeker_screening_answers").select("question_key, answer").eq("organization_id", activeOrganization.id),
    ]);
    if (profileError) return databaseErrorResponse(profileError);
    if (answersError) return databaseErrorResponse(answersError);

    const lines = extractRequirements(job.description);
    const profile = profileRow === null
      ? { fullName: null, email: null, phone: null, linkedinUrl: null, location: null, summary: null, skills: [], technologies: [], certifications: [], employmentHistory: [], education: [] }
      : toKitProfile(profileRow);
    const checks = checkRequirements(lines, profile, toScreeningAnswers((answerRows ?? []) as Array<{ question_key: string; answer: string }>));
    return jsonNoStore({
      jobId: job.id,
      checks,
      counts: {
        met: checks.filter((check) => check.verdict === "met").length,
        unmet: checks.filter((check) => check.verdict === "unmet").length,
        unknown: checks.filter((check) => check.verdict === "unknown").length,
      },
      basis: job.description === null
        ? "The posting has no description recorded, so there are no requirement lines to check."
        : profileRow === null
          ? "No Career Profile is recorded, so every line is unknown until you record one."
          : "Each line is the posting's own sentence, checked against your recorded profile and screening answers; nothing is assumed met.",
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "requirements_unavailable", message: "The requirements could not be checked." } },
      { status: 500 },
    );
  }
}
