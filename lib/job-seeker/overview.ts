/**
 * The Overview's numbers, as a pure function over recorded jobs.
 *
 * The dashboard reads one endpoint — the same recorded jobs, matches and
 * applications every other Job Seeker page reads — and derives every figure
 * here. That is deliberate: a summary computed from a different source than
 * the page it links to is a summary that can disagree with it, and a person
 * cannot tell which of the two is lying.
 */

export type JobSeekerJobView = Readonly<{
  id: string;
  title: string;
  company: string;
  discoveredAt?: string | null;
  match?: Readonly<{ score: number; qualified: boolean }> | null;
  application?: Readonly<{ id: string; stage: string }> | null;
}>;

/**
 * The recorded lifecycle, in order, with the labels a person reads.
 *
 * Taken from the `job_seeker_stage` enum rather than invented, so a stage the
 * database can hold always has a name here.
 */
export const APPLICATION_STAGES: ReadonlyArray<{ stage: string; label: string }> = [
  { stage: "FOUND", label: "Found" },
  { stage: "QUALIFIED", label: "Qualified" },
  { stage: "RESUME_CREATED", label: "Resume created" },
  { stage: "READY_FOR_REVIEW", label: "Ready for review" },
  { stage: "APPLIED", label: "Applied" },
  { stage: "FOLLOW_UP", label: "Follow-up" },
  { stage: "RECRUITER_RESPONSE", label: "Recruiter response" },
  { stage: "INTERVIEW", label: "Interview" },
  { stage: "FINAL_INTERVIEW", label: "Final interview" },
  { stage: "OFFER", label: "Offer" },
  { stage: "CLOSED", label: "Closed" },
];

const STAGE_LABEL = new Map(APPLICATION_STAGES.map((entry) => [entry.stage, entry.label]));

/** Stages at or past a real submission. */
const SUBMITTED = new Set([
  "APPLIED", "FOLLOW_UP", "RECRUITER_RESPONSE", "INTERVIEW", "FINAL_INTERVIEW", "OFFER", "CLOSED",
]);
const INTERVIEWING = new Set(["INTERVIEW", "FINAL_INTERVIEW"]);

const SCORE_BANDS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: "90-100", min: 90, max: 100 },
  { label: "80-89", min: 80, max: 89 },
  { label: "60-79", min: 60, max: 79 },
  { label: "<60", min: 0, max: 59 },
];

export type OverviewModel = Readonly<{
  jobsFound: number;
  scored: number;
  applicationsTotal: number;
  applied: number;
  interviews: number;
  offers: number;
  averageMatchScore: number | null;
  byStage: ReadonlyArray<{ stage: string; label: string; count: number; percent: number }>;
  scoreBands: ReadonlyArray<{ label: string; count: number; percent: number }>;
  recent: ReadonlyArray<{
    id: string;
    title: string;
    company: string;
    score: number | null;
    stageLabel: string;
  }>;
  topTitles: ReadonlyArray<{
    title: string;
    jobs: number;
    applied: number;
    bestScore: number | null;
  }>;
}>;

function percentOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

export function stageLabel(stage: string): string {
  return STAGE_LABEL.get(stage) ?? stage;
}

export function buildOverview(jobs: readonly JobSeekerJobView[]): OverviewModel {
  const scoredJobs = jobs.filter((job) => typeof job.match?.score === "number");
  const applications = jobs.filter((job) => job.application);

  const byStageCount = new Map<string, number>();
  for (const job of applications) {
    const stage = job.application?.stage ?? "FOUND";
    byStageCount.set(stage, (byStageCount.get(stage) ?? 0) + 1);
  }

  const byStage = APPLICATION_STAGES
    .map((entry) => ({
      stage: entry.stage,
      label: entry.label,
      count: byStageCount.get(entry.stage) ?? 0,
      percent: percentOf(byStageCount.get(entry.stage) ?? 0, applications.length),
    }))
    // Only stages that actually hold something: a row of eleven zeroes tells
    // a person nothing about their search.
    .filter((entry) => entry.count > 0);

  const scoreBands = SCORE_BANDS.map((band) => {
    const count = scoredJobs.filter((job) => {
      const score = job.match?.score ?? -1;
      return score >= band.min && score <= band.max;
    }).length;
    return { label: band.label, count, percent: percentOf(count, scoredJobs.length) };
  });

  const byTitle = new Map<string, { jobs: number; applied: number; bestScore: number | null }>();
  for (const job of jobs) {
    const entry = byTitle.get(job.title) ?? { jobs: 0, applied: 0, bestScore: null };
    entry.jobs += 1;
    if (job.application && SUBMITTED.has(job.application.stage)) entry.applied += 1;
    const score = job.match?.score;
    if (typeof score === "number" && (entry.bestScore === null || score > entry.bestScore)) {
      entry.bestScore = score;
    }
    byTitle.set(job.title, entry);
  }

  return Object.freeze({
    jobsFound: jobs.length,
    scored: scoredJobs.length,
    applicationsTotal: applications.length,
    applied: applications.filter((job) => SUBMITTED.has(job.application?.stage ?? "")).length,
    interviews: applications.filter((job) => INTERVIEWING.has(job.application?.stage ?? "")).length,
    offers: applications.filter((job) => job.application?.stage === "OFFER").length,
    averageMatchScore: scoredJobs.length > 0
      ? Math.round(
        scoredJobs.reduce((sum, job) => sum + (job.match?.score ?? 0), 0) / scoredJobs.length,
      )
      : null,
    byStage,
    scoreBands,
    recent: applications
      // Newest first where a date exists; a job with none sorts last rather
      // than being given a date it does not have.
      .slice()
      .sort((a, b) => (b.discoveredAt ?? "").localeCompare(a.discoveredAt ?? ""))
      .slice(0, 5)
      .map((job) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        score: job.match?.score ?? null,
        stageLabel: stageLabel(job.application?.stage ?? "FOUND"),
      })),
    topTitles: [...byTitle.entries()]
      .map(([title, entry]) => ({ title, ...entry }))
      .sort((a, b) => (b.bestScore ?? -1) - (a.bestScore ?? -1) || b.jobs - a.jobs)
      .slice(0, 5),
  });
}
