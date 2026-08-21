import { evaluateJob, hasLeadershipEvidence } from "@/lib/job-seeker/evaluate";

/**
 * Shared server-side recording for scored jobs: the same evaluate → insert
 * job → insert match → insert application chain the manual record route
 * runs, made callable per posting so the import route can fold a whole
 * board through it with duplicates counted instead of fatal.
 *
 * The client passed in is the caller's RLS-scoped Supabase client; nothing
 * here widens access, and every insert still carries organization_id and
 * user_id so the schema's ownership checks hold.
 */

type QueryClient = Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>;

export type EvaluationInputs = Readonly<{
  profile: Parameters<typeof evaluateJob>[0];
  preferences: Parameters<typeof evaluateJob>[1];
}>;

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

  const profile = (profileRow ?? {}) as Record<string, unknown>;
  const preferences = (preferencesRow ?? {}) as Record<string, unknown>;
  const history = (profile.employment_history ?? []) as Array<{ title: string; summary?: string; highlights?: string[] }>;

  return {
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

/**
 * Insert one job with its match and pipeline entry. A unique-index conflict
 * (same person, company, title, external id) is a counted outcome, not an
 * error; any other database refusal is thrown for the route to translate.
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
  const { organizationId, userId, source, job, inputs } = args;
  const evaluation = evaluateJob(inputs.profile, inputs.preferences, {
    title: job.title,
    company: job.company,
    description: job.description,
    salaryText: job.salaryText,
    location: job.location,
    workModel: job.workModel,
  });

  const { data: jobRow, error: jobError } = await client
    .from("job_seeker_jobs")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      source,
      external_id: job.externalId,
      url: job.url,
      title: job.title,
      company: job.company,
      salary_text: job.salaryText,
      location: job.location,
      work_model: job.workModel,
      description: job.description,
    })
    .select("id")
    .single();
  if (jobError) {
    if (jobError.code === "23505") return { outcome: "duplicate" };
    throw jobError;
  }
  const jobId = (jobRow as { id: string }).id;

  const { error: matchError } = await client.from("job_seeker_matches").insert({
    organization_id: organizationId,
    user_id: userId,
    job_id: jobId,
    score: evaluation.score,
    breakdown: evaluation.breakdown,
    reasons: evaluation.reasons,
    gaps: evaluation.gaps,
    threshold_used: evaluation.threshold,
    qualified: evaluation.qualified,
  });
  if (matchError) throw matchError;

  const { error: applicationError } = await client.from("job_seeker_applications").insert({
    organization_id: organizationId,
    user_id: userId,
    job_id: jobId,
    stage: evaluation.qualified ? "QUALIFIED" : "FOUND",
  });
  if (applicationError) throw applicationError;

  return { outcome: "recorded", jobId, qualified: evaluation.qualified, score: evaluation.score };
}
