import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { evaluateJob, hasLeadershipEvidence } from "@/lib/job-seeker/evaluate";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Recorded jobs, with their match evaluation. Recording is manual today —
 * the `source` column says so — and every score is computed from recorded
 * facts at recording time, stored with its breakdown, reasons, and gaps so
 * the number never stands without its evidence.
 */

const recordJobSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    company: z.string().trim().min(1).max(300),
    url: z.string().trim().url().max(800).nullish(),
    externalId: z.string().trim().min(1).max(200).nullish(),
    salaryText: z.string().trim().min(1).max(200).nullish(),
    location: z.string().trim().min(1).max(200).nullish(),
    workModel: z.enum(["remote", "hybrid", "onsite", "any"]).nullish(),
    description: z.string().trim().max(30_000).nullish(),
  })
  .strict();

type JobRow = {
  id: string;
  source: string;
  external_id: string | null;
  url: string | null;
  title: string;
  company: string;
  salary_text: string | null;
  location: string | null;
  work_model: string | null;
  description: string | null;
  discovered_at: string;
  job_seeker_matches: MatchEmbed | MatchEmbed[] | null;
  job_seeker_applications: ApplicationEmbed | ApplicationEmbed[] | null;
};

type MatchEmbed = {
  score: number;
  breakdown: Record<string, number>;
  reasons: string[];
  gaps: string[];
  threshold_used: number;
  qualified: boolean;
};

type ApplicationEmbed = {
  id: string;
  stage: string;
  approval_status: string;
  application_url: string | null;
  notes: string | null;
  follow_up_at: string | null;
  applied_at: string | null;
};

/*
 * Both embeds are one-to-one — job_seeker_matches and job_seeker_applications
 * each carry `unique (job_id)` — so live PostgREST returns them as a single
 * object (or null), not an array. The array shape is still accepted because
 * shape detection follows the constraint, and a fixture or a schema cache
 * mid-reload can present the other form. Reading only `[0]` here made every
 * live record look unscored: the journey test caught it against the real
 * stack.
 */
function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const JOB_COLUMNS =
  "id, source, external_id, url, title, company, salary_text, location, work_model, "
  + "description, discovered_at, "
  + "job_seeker_matches ( score, breakdown, reasons, gaps, threshold_used, qualified ), "
  + "job_seeker_applications ( id, stage, approval_status, application_url, notes, follow_up_at, applied_at )";

function toView(row: JobRow) {
  const match = firstEmbed(row.job_seeker_matches);
  const application = firstEmbed(row.job_seeker_applications);
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    url: row.url,
    title: row.title,
    company: row.company,
    salaryText: row.salary_text,
    location: row.location,
    workModel: row.work_model,
    description: row.description,
    discoveredAt: row.discovered_at,
    match: match
      ? {
        score: match.score,
        breakdown: match.breakdown,
        reasons: match.reasons ?? [],
        gaps: match.gaps ?? [],
        threshold: match.threshold_used,
        qualified: match.qualified,
      }
      : null,
    application: application
      ? {
        id: application.id,
        stage: application.stage,
        /*
         * When it was actually submitted, which is a different question from
         * when the job was discovered. The Overview plots submissions over
         * time, and plotting discovery instead would be a chart that answers
         * a question nobody asked while carrying the label of one they did.
         */
        appliedAt: application.applied_at,
        approvalStatus: application.approval_status,
        applicationUrl: application.application_url,
        notes: application.notes,
        followUpAt: application.follow_up_at,
      }
      : null,
  };
}

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_jobs")
      .select(JOB_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("discovered_at", { ascending: false })
      .limit(200);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ jobs: ((data ?? []) as unknown as JobRow[]).map(toView) });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_jobs_unavailable", message: "Recorded jobs could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = recordJobSchema.parse(await readBoundedJson(request, 128_000));
    const sensitive = findSensitiveData(payload);
    if (sensitive) {
      throw new ApiRequestError(
        422,
        "sensitive_content",
        `The job record appears to contain a credential-shaped value at ${sensitive.path}; remove it and record again.`,
      );
    }

    const { client, user, activeOrganization } = await requireActiveOrganization();

    // The evaluation draws on recorded facts; absent rows evaluate honestly
    // as absent facts (the gaps will say the profile is empty).
    const [{ data: profileRow }, { data: preferencesRow }] = await Promise.all([
      client
        .from("job_seeker_profiles")
        .select("skills, technologies, industries, employment_history, salary_target, location, work_arrangement, open_to_relocation")
        .eq("organization_id", activeOrganization.id)
        .maybeSingle(),
      client
        .from("job_seeker_preferences")
        .select("target_titles, compensation_minimum, locations, work_arrangements, industries, exclusions, qualification_threshold")
        .eq("organization_id", activeOrganization.id)
        .maybeSingle(),
    ]);

    const history = (profileRow?.employment_history ?? []) as Array<{ title: string; summary?: string; highlights?: string[] }>;
    const evaluation = evaluateJob(
      {
        skills: (profileRow?.skills ?? []) as string[],
        technologies: (profileRow?.technologies ?? []) as string[],
        industries: (profileRow?.industries ?? []) as string[],
        employmentTitles: history.map((entry) => entry.title),
        hasLeadershipEvidence: hasLeadershipEvidence(history),
        salaryTarget: profileRow?.salary_target ?? null,
        location: profileRow?.location ?? null,
        workArrangement: (profileRow?.work_arrangement ?? "any") as string,
        openToRelocation: profileRow?.open_to_relocation ?? false,
      },
      {
        targetTitles: (preferencesRow?.target_titles ?? []) as string[],
        compensationMinimum: preferencesRow?.compensation_minimum ?? null,
        locations: (preferencesRow?.locations ?? []) as string[],
        workArrangements: (preferencesRow?.work_arrangements ?? []) as string[],
        industries: (preferencesRow?.industries ?? []) as string[],
        exclusions: (preferencesRow?.exclusions ?? []) as string[],
        qualificationThreshold: preferencesRow?.qualification_threshold ?? 80,
      },
      {
        title: payload.title,
        company: payload.company,
        description: payload.description ?? null,
        salaryText: payload.salaryText ?? null,
        location: payload.location ?? null,
        workModel: payload.workModel === "any" ? null : payload.workModel ?? null,
      },
    );

    const { data: jobRow, error: jobError } = await client
      .from("job_seeker_jobs")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        source: "manual",
        external_id: payload.externalId ?? null,
        url: payload.url ?? null,
        title: payload.title,
        company: payload.company,
        salary_text: payload.salaryText ?? null,
        location: payload.location ?? null,
        work_model: payload.workModel === "any" ? null : payload.workModel ?? null,
        description: payload.description ?? null,
      })
      .select("id")
      .single<{ id: string }>();
    if (jobError) {
      if (jobError.code === "23505") {
        return jsonNoStore(
          { error: { code: "duplicate_job", message: "This job is already recorded: same company, title, and job id." } },
          { status: 409 },
        );
      }
      return databaseErrorResponse(jobError);
    }

    const { error: matchError } = await client.from("job_seeker_matches").insert({
      organization_id: activeOrganization.id,
      user_id: user.id,
      job_id: jobRow.id,
      score: evaluation.score,
      breakdown: evaluation.breakdown,
      reasons: evaluation.reasons,
      gaps: evaluation.gaps,
      threshold_used: evaluation.threshold,
      qualified: evaluation.qualified,
    });
    if (matchError) return databaseErrorResponse(matchError);

    // Every recorded job enters the pipeline at its honest stage.
    const { error: applicationError } = await client.from("job_seeker_applications").insert({
      organization_id: activeOrganization.id,
      user_id: user.id,
      job_id: jobRow.id,
      stage: evaluation.qualified ? "QUALIFIED" : "FOUND",
    });
    if (applicationError) return databaseErrorResponse(applicationError);

    const { data: fullRow, error: readError } = await client
      .from("job_seeker_jobs")
      .select(JOB_COLUMNS)
      .eq("id", jobRow.id)
      .single<JobRow>();
    if (readError) return databaseErrorResponse(readError);
    return jsonNoStore({ job: toView(fullRow as unknown as JobRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_job", message: "The job payload is not valid.", issues: error.issues.slice(0, 5) } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_jobs_unavailable", message: "The job could not be recorded." } },
      { status: 500 },
    );
  }
}
