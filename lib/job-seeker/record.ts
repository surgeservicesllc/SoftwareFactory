import { evaluateJob, hasLeadershipEvidence } from "@/lib/job-seeker/evaluate";

/**
 * Shared server-side recording for scored jobs. Evaluation stays in this
 * server-only module; persistence crosses one database RPC boundary so the
 * job, match, application, and immutable audit event commit together.
 *
 * The client passed in is the caller's RLS-scoped Supabase client. The RPC
 * derives user ownership from auth.uid() and verifies organization membership
 * instead of trusting the userId supplied by a route.
 */

type QueryClient = Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>;

export type EvaluationInputs = Readonly<{
  profile: Parameters<typeof evaluateJob>[0];
  preferences: Parameters<typeof evaluateJob>[1];
  /**
   * Whether a profile row actually exists. The facts above default to empty
   * when it does not, which scores honestly (all gaps) — but a caller that
   * would present scores computed over nothing can use this to say
   * "no profile recorded" instead.
   */
  profileRecorded: boolean;
}>;

/**
 * Column-shaped rows to evaluator facts, shared by every caller that reads
 * the profile through a different transport (the RLS client here, the alert
 * engine's definer boundary elsewhere). One mapping, or the facts drift.
 */
export function toEvaluationInputs(
  profileRow: Record<string, unknown> | null,
  preferencesRow: Record<string, unknown> | null,
): EvaluationInputs {
  const profile = (profileRow ?? {}) as Record<string, unknown>;
  const preferences = (preferencesRow ?? {}) as Record<string, unknown>;
  const history = (profile.employment_history ?? []) as Array<{ title: string; summary?: string; highlights?: string[] }>;

  return {
    profileRecorded: profileRow !== null,
    profile: {
      skills: (profile.skills ?? []) as string[],
      technologies: (profile.technologies ?? []) as string[],
      industries: (profile.industries ?? []) as string[],
      employmentTitles: history.map((entry) => entry.title),
      hasLeadershipEvidence: hasLeadershipEvidence(history),
      salaryTarget: (profile.salary_target ?? null) as number | null,
      location: (profile.location ?? null) as string | null,
      workArrangement: (profile.work_arrangement ?? "any") as string,
      openToRelocation: (profile.open_to_relocation ?? false) as boolean,
    },
    preferences: {
      targetTitles: (preferences.target_titles ?? []) as string[],
      compensationMinimum: (preferences.compensation_minimum ?? null) as number | null,
      locations: (preferences.locations ?? []) as string[],
      workArrangements: (preferences.work_arrangements ?? []) as string[],
      industries: (preferences.industries ?? []) as string[],
      exclusions: (preferences.exclusions ?? []) as string[],
      qualificationThreshold: (preferences.qualification_threshold ?? 80) as number,
    },
  };
}

/** One load per request; every posting is evaluated against the same facts. */
export async function loadEvaluationInputs(
  client: QueryClient,
  organizationId: string,
): Promise<EvaluationInputs> {
  const [{ data: profileRow }, { data: preferencesRow }] = await Promise.all([
    client
      .from("job_seeker_profiles")
      .select("skills, technologies, industries, employment_history, salary_target, location, work_arrangement, open_to_relocation")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    client
      .from("job_seeker_preferences")
      .select("target_titles, compensation_minimum, locations, work_arrangements, industries, exclusions, qualification_threshold")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  return toEvaluationInputs(
    profileRow as Record<string, unknown> | null,
    preferencesRow as Record<string, unknown> | null,
  );
}

export type RecordableJob = Readonly<{
  externalId: string | null;
  url: string | null;
  title: string;
  company: string;
  salaryText: string | null;
  location: string | null;
  workModel: "remote" | "hybrid" | "onsite" | null;
  description: string | null;
}>;

export type RecordOutcome =
  | Readonly<{ outcome: "recorded"; jobId: string; qualified: boolean; score: number }>
  | Readonly<{ outcome: "duplicate" }>;

type RecordJobRpcRow = Readonly<{
  outcome: "recorded" | "duplicate";
  job_id: string | null;
  qualified: boolean | null;
  score: number | null;
}>;

/**
 * Atomically record one job with its match, pipeline entry, and audit event.
 * A unique-index conflict (same person, company, title, external id) is a
 * counted outcome, not an error; any other refusal is thrown for the route to
 * translate. userId remains in the public API for existing callers, but the
 * database intentionally ignores it and owns the row as auth.uid().
 */
export async function insertScoredJob(
  client: QueryClient,
  args: Readonly<{
    organizationId: string;
    userId: string;
    source: string;
    job: RecordableJob;
    inputs: EvaluationInputs;
  }>,
): Promise<RecordOutcome> {
  const { organizationId, source, job, inputs } = args;
  const evaluation = evaluateJob(inputs.profile, inputs.preferences, {
    title: job.title,
    company: job.company,
    description: job.description,
    salaryText: job.salaryText,
    location: job.location,
    workModel: job.workModel,
  });

  const { data, error } = await client
    .rpc("record_job_seeker_job", {
      p_organization_id: organizationId,
      p_source: source,
      p_external_id: job.externalId,
      p_url: job.url,
      p_title: job.title,
      p_company: job.company,
      p_salary_text: job.salaryText,
      p_location: job.location,
      p_work_model: job.workModel,
      p_description: job.description,
      p_score: evaluation.score,
      p_breakdown: evaluation.breakdown,
      p_reasons: evaluation.reasons,
      p_gaps: evaluation.gaps,
      p_threshold_used: evaluation.threshold,
      p_qualified: evaluation.qualified,
    })
    .single();

  if (error) throw error;

  const result = data as RecordJobRpcRow | null;
  if (!result || (result.outcome !== "recorded" && result.outcome !== "duplicate")) {
    throw new Error("The job recording function returned an invalid outcome.");
  }
  if (result.outcome === "duplicate") return { outcome: "duplicate" };
  if (result.job_id === null || result.score === null || result.qualified === null) {
    throw new Error("The job recording function returned an incomplete recorded outcome.");
  }

  return {
    outcome: "recorded",
    jobId: result.job_id,
    qualified: result.qualified,
    score: result.score,
  };
}
