import {
  DEFAULT_QUALIFICATION_THRESHOLD,
  JOB_SEEKER_WEIGHTS,
  scoreJob,
  type MatchComponent,
  type ScoredMatch,
} from "@/lib/job-seeker/scoring";

/**
 * First-pass match evaluation: deterministic rules over RECORDED FACTS.
 *
 * Every component judgment below derives from what the person wrote in their
 * profile and preferences and what the job posting says — string overlap,
 * salary arithmetic, arrangement compatibility. No model is consulted and no
 * qualification is ever invented: a fact that is not recorded contributes
 * nothing, and every reason and gap names the fact it came from. The UI
 * labels the result as exactly this. Model-assisted extraction can replace
 * individual judgments later through the graph engine's verified lanes; the
 * arithmetic (scoreJob) and the stored shape stay identical when it does.
 */

export type ProfileFacts = Readonly<{
  skills: readonly string[];
  technologies: readonly string[];
  industries: readonly string[];
  employmentTitles: readonly string[];
  hasLeadershipEvidence: boolean;
  salaryTarget: number | null;
  location: string | null;
  workArrangement: string;
  openToRelocation: boolean;
}>;

export type PreferenceFacts = Readonly<{
  targetTitles: readonly string[];
  compensationMinimum: number | null;
  locations: readonly string[];
  workArrangements: readonly string[];
  industries: readonly string[];
  exclusions: readonly string[];
  qualificationThreshold: number;
}>;

export type JobFacts = Readonly<{
  title: string;
  company: string;
  description: string | null;
  salaryText: string | null;
  location: string | null;
  workModel: string | null;
}>;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function containsTerm(haystack: string, term: string): boolean {
  return haystack.includes(normalize(term));
}

/** Words like "lead", "manage", "mentor" in recorded history, not guessed. */
const LEADERSHIP_MARKERS = ["lead", "manag", "mentor", "head of", "director", "principal", "staff"];

export function hasLeadershipEvidence(entries: ReadonlyArray<{ title: string; summary?: string; highlights?: readonly string[] }>): boolean {
  return entries.some((entry) => {
    const text = normalize([entry.title, entry.summary ?? "", ...(entry.highlights ?? [])].join(" "));
    return LEADERSHIP_MARKERS.some((marker) => text.includes(marker));
  });
}

/** Best-effort numeric read of a salary string; null when none is stated. */
export function readSalaryFigure(salaryText: string | null): number | null {
  if (!salaryText) return null;
  const matches = [...salaryText.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi)]
    .map((match) => {
      const base = Number(match[1].replaceAll(",", ""));
      return match[2] ? base * 1000 : base;
    })
    .filter((value) => Number.isFinite(value) && value >= 1000);
  if (matches.length === 0) return null;
  // The top of a stated range is the honest "up to" figure.
  return Math.max(...matches);
}

export type Evaluation = ScoredMatch & Readonly<{ excluded: string | null }>;

export function evaluateJob(
  profile: ProfileFacts,
  preferences: PreferenceFacts,
  job: JobFacts,
): Evaluation {
  const text = normalize([job.title, job.description ?? ""].join(" "));
  const reasons: string[] = [];
  const gaps: string[] = [];
  const breakdown: Partial<Record<MatchComponent, number>> = {};

  // Exclusions veto before anything is scored.
  const exclusion = preferences.exclusions.find((term) => containsTerm(text, term) || containsTerm(normalize(job.company), term));
  if (exclusion) {
    return {
      ...scoreJob({ breakdown: {}, threshold: preferences.qualificationThreshold, reasons: [], gaps: [`Matches your exclusion "${exclusion}".`] }),
      excluded: exclusion,
    };
  }

  // Experience (30): recorded titles vs the posting's title.
  const jobTitle = normalize(job.title);
  const titleHit = [...profile.employmentTitles, ...preferences.targetTitles]
    .find((title) => title && (jobTitle.includes(normalize(title)) || normalize(title).includes(jobTitle)));
  if (titleHit) {
    breakdown.experience = 30;
    reasons.push(`The role's title aligns with your recorded "${titleHit}".`);
  } else {
    const wordOverlap = jobTitle.split(" ").filter((word) =>
      word.length > 3 && [...profile.employmentTitles, ...preferences.targetTitles]
        .some((title) => normalize(title).includes(word)));
    breakdown.experience = wordOverlap.length > 0 ? 18 : 0;
    if (wordOverlap.length > 0) reasons.push(`Partial title overlap on ${wordOverlap.join(", ")}.`);
    else gaps.push("No recorded title or target title resembles this role's title.");
  }

  // Skills (20): recorded skills+technologies named in the posting.
  const skillPool = [...profile.skills, ...profile.technologies];
  const namedSkills = skillPool.filter((skill) => containsTerm(text, skill));
  if (skillPool.length === 0) {
    gaps.push("Your profile lists no skills yet, so skill fit cannot be assessed.");
    breakdown.skills = 0;
  } else if (job.description) {
    breakdown.skills = Math.round(20 * Math.min(1, namedSkills.length / 5));
    if (namedSkills.length > 0) reasons.push(`The posting names ${namedSkills.slice(0, 5).join(", ")} from your profile.`);
    else gaps.push("The posting names none of your recorded skills.");
  } else {
    breakdown.skills = 0;
    gaps.push("The posting has no description to assess skills against.");
  }

  // Leadership (15): evidence recorded in employment history.
  if (profile.hasLeadershipEvidence) {
    breakdown.leadership = 15;
    reasons.push("Your employment history records leadership scope.");
  } else {
    breakdown.leadership = 0;
    gaps.push("No leadership evidence is recorded in your history.");
  }

  // Industry (10): recorded industries named in the posting.
  const industryHit = [...profile.industries, ...preferences.industries].find((industry) => containsTerm(text, industry));
  if (industryHit) {
    breakdown.industry = 10;
    reasons.push(`Industry match on "${industryHit}".`);
  } else {
    breakdown.industry = 0;
    gaps.push("The posting names none of your recorded industries.");
  }

  // Compensation (10): the posting's figure vs your recorded floor/target.
  const figure = readSalaryFigure(job.salaryText);
  const floor = preferences.compensationMinimum ?? profile.salaryTarget;
  if (figure !== null && floor !== null) {
    breakdown.compensation = figure >= floor ? 10 : 0;
    if (figure >= floor) reasons.push(`Stated compensation (${figure.toLocaleString()}) meets your ${floor.toLocaleString()} floor.`);
    else gaps.push(`Stated compensation (${figure.toLocaleString()}) is below your ${floor.toLocaleString()} floor.`);
  } else {
    breakdown.compensation = 5;
    gaps.push(figure === null
      ? "The posting states no readable compensation figure."
      : "You have not recorded a compensation floor or salary target.");
  }

  // Location (10): arrangement compatibility, then place names.
  const model = job.workModel ?? (text.includes("remote") ? "remote" : null);
  const wanted = preferences.workArrangements.length > 0
    ? preferences.workArrangements
    : [profile.workArrangement];
  if (model && (wanted.includes(model) || wanted.includes("any"))) {
    breakdown.location = 10;
    reasons.push(`The role's ${model} arrangement matches your preference.`);
  } else if (job.location && [profile.location, ...preferences.locations].some(
    (place) => place && containsTerm(normalize(job.location ?? ""), place),
  )) {
    breakdown.location = 10;
    reasons.push(`The role's location (${job.location}) matches a recorded preference.`);
  } else if (profile.openToRelocation) {
    breakdown.location = 5;
    reasons.push("You are open to relocation.");
  } else {
    breakdown.location = 0;
    gaps.push("Neither the arrangement nor the location matches your recorded preferences.");
  }

  // Career growth (5): a seniority step up from recorded titles.
  const growthMarkers = ["senior", "staff", "principal", "lead", "head", "director", "vp"];
  const growthHit = growthMarkers.find((marker) => jobTitle.includes(marker));
  breakdown.career_growth = growthHit ? 5 : 0;
  if (growthHit) reasons.push(`The role carries "${growthHit}" seniority.`);

  return {
    ...scoreJob({
      breakdown,
      threshold: preferences.qualificationThreshold ?? DEFAULT_QUALIFICATION_THRESHOLD,
      reasons,
      gaps,
    }),
    excluded: null,
  };
}

export const EVALUATION_METHOD_LABEL =
  "Rule-based match computed from your recorded profile and preferences — "
  + `weights ${Object.entries(JOB_SEEKER_WEIGHTS).map(([k, v]) => `${k} ${v}`).join(", ")}.`;
