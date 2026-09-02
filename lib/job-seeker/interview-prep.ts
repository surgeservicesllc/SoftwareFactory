import {
  checkRequirements,
  extractRequirements,
  type KitProfile,
  type RequirementCheck,
  type ScreeningAnswers,
} from "@/lib/job-seeker/application-kit";
import {
  postingCompleteness,
  scanRedFlags,
  type CompletenessField,
  type WorkModel,
} from "@/lib/job-seeker/board-search/signals";
import { namedSkills, type CompanyMemory } from "@/lib/job-seeker/what-costs";

/**
 * The interview prep sheet (ADR-246), composed from the person's own facts.
 *
 * Every line is traceable to a recorded row or to the posting's own text:
 * the strengths are the posting's terms the profile records, with where
 * they are recorded; the gaps are the posting's terms it does not; the
 * lines to answer are the requirement sentences the kit could not mark
 * met; the history is the recorded entries that share a term with the
 * posting, highlights copied verbatim; the questions to ask come from what
 * the posting failed to state and from its red flags, each naming the
 * fact. Nothing here is generated. Model-written questions, when a
 * provider exists, live in a separate lane and carry their own label.
 */

export type PrepJob = Readonly<{
  title: string;
  company: string;
  description: string | null;
  salaryText: string | null;
  location: string | null;
  workModel: WorkModel | null;
  publishedOn: string | null;
}>;

export type PrepApplication = Readonly<{
  stage: string;
  notes: string | null;
  appliedAt: string | null;
  followUpAt: string | null;
}>;

export type PrepContact = Readonly<{ name: string; role: string | null; source: string | null }>;

export type Strength = Readonly<{
  term: string;
  /** Where the term is recorded, in the person's own record. */
  evidence: string;
}>;

export type Gap = Readonly<{ term: string; sentence: string }>;

export type HistoryMatch = Readonly<{
  organization: string;
  title: string;
  span: string | null;
  sharedTerms: string[];
  /** Copied from the recorded entry, never reworded. */
  highlights: string[];
}>;

export type PrepSheet = Readonly<{
  strengths: Strength[];
  gaps: Gap[];
  /** The posting's requirement lines the kit could not mark met (ADR-244). */
  toAnswer: RequirementCheck[];
  history: HistoryMatch[];
  questionsToAsk: string[];
  memory: CompanyMemory | null;
  contacts: PrepContact[];
  notes: string | null;
  basis: string;
}>;

export const PREP_BASIS =
  "Composed from your recorded profile, screening answers, this posting's own text, your application and its contacts — nothing on this sheet is generated.";

function lower(text: string): string {
  return text.toLowerCase();
}

function names(text: string, term: string): boolean {
  return lower(text).includes(lower(term));
}

/** The vocabulary terms the posting names that the profile records, with where. */
export function matchedStrengths(job: PrepJob, profile: KitProfile): Strength[] {
  const text = `${job.title} ${job.description ?? ""}`;
  const seen = new Set<string>();
  const strengths: Strength[] = [];
  const pools: ReadonlyArray<readonly [readonly string[], string]> = [
    [profile.skills, "listed under your skills"],
    [profile.technologies, "listed under your technologies"],
    [profile.certifications, "a recorded certification"],
  ];
  for (const [pool, where] of pools) {
    for (const term of pool) {
      const key = lower(term.trim());
      if (key.length === 0 || seen.has(key) || !names(text, term)) continue;
      seen.add(key);
      const used = profile.employmentHistory.find((entry) =>
        names(`${entry.title} ${entry.summary ?? ""} ${(entry.highlights ?? []).join(" ")}`, term),
      );
      strengths.push({
        term: term.trim(),
        evidence: used
          ? `${where}; used at ${used.organization} as ${used.title}`
          : where,
      });
    }
  }
  return strengths;
}

/** The vocabulary terms the posting names that the profile does not list. */
export function gapsToPrepare(job: PrepJob, profile: KitProfile): Gap[] {
  const recorded = new Set(
    [...profile.skills, ...profile.technologies, ...profile.certifications].map((term) => lower(term.trim())),
  );
  return namedSkills(`${job.title} ${job.description ?? ""}`)
    .filter((term) => !recorded.has(lower(term)))
    .map((term) => ({
      term,
      sentence: `The posting names ${term}; your profile does not. Decide what you will say about it.`,
    }));
}

function span(entry: KitProfile["employmentHistory"][number]): string | null {
  if (!entry.started && !entry.ended) return null;
  return `${entry.started ?? "?"} – ${entry.ended ?? "present"}`;
}

/**
 * The recorded employment entries that share a term with the posting,
 * most shared first. Terms are the posting's vocabulary terms plus the
 * strengths above, so an entry is matched on things the posting actually
 * names. Highlights are copied verbatim.
 */
export function relevantHistory(job: PrepJob, profile: KitProfile): HistoryMatch[] {
  const text = `${job.title} ${job.description ?? ""}`;
  const terms = [...new Set([
    ...namedSkills(text),
    ...matchedStrengths(job, profile).map((strength) => strength.term),
  ])];
  return profile.employmentHistory
    .map((entry) => {
      const entryText = `${entry.title} ${entry.summary ?? ""} ${(entry.highlights ?? []).join(" ")}`;
      const sharedTerms = terms.filter((term) => names(entryText, term));
      return {
        organization: entry.organization,
        title: entry.title,
        span: span(entry),
        sharedTerms,
        highlights: [...(entry.highlights ?? [])],
      };
    })
    .filter((entry) => entry.sharedTerms.length > 0)
    .sort((a, b) => b.sharedTerms.length - a.sharedTerms.length);
}

const MISSING_FACT_QUESTIONS: Readonly<Partial<Record<CompletenessField, string>>> = {
  pay: "What is the salary range for this role? The posting does not state pay.",
  place: "Where is the role based? The posting names no place.",
  work_model: "Is the role remote, hybrid or on site? The posting does not say.",
  level: "What level is this role, and what does progression look like? The title states no level.",
  description: "What does the day-to-day work look like? The posting's description is under 200 characters.",
};

/** Questions for the interviewer, each naming the fact the posting left out. */
export function questionsToAsk(job: PrepJob, titleStatesLevel: boolean): string[] {
  const completeness = postingCompleteness({
    salaryText: job.salaryText,
    location: job.location,
    workModel: job.workModel,
    titleStatesLevel,
    description: job.description,
    publishedOn: job.publishedOn,
  });
  const questions = completeness.missing
    .map((field) => MISSING_FACT_QUESTIONS[field])
    .filter((question): question is string => question !== undefined);
  for (const flag of scanRedFlags(`${job.title} ${job.description ?? ""}`)) {
    questions.push(`The posting says “${flag.phrase}” — ask what that means in practice. ${flag.label}`);
  }
  return questions;
}

export function buildPrepSheet(args: Readonly<{
  job: PrepJob;
  titleStatesLevel: boolean;
  profile: KitProfile;
  answers: ScreeningAnswers;
  application: PrepApplication | null;
  contacts: readonly PrepContact[];
  memory: CompanyMemory | null;
  now?: Date;
}>): PrepSheet {
  const { job, profile } = args;
  return {
    strengths: matchedStrengths(job, profile),
    gaps: gapsToPrepare(job, profile),
    toAnswer: checkRequirements(extractRequirements(job.description), profile, args.answers, args.now)
      .filter((check) => check.verdict !== "met"),
    history: relevantHistory(job, profile),
    questionsToAsk: questionsToAsk(job, args.titleStatesLevel),
    memory: args.memory,
    contacts: [...args.contacts],
    notes: args.application?.notes ?? null,
    basis: PREP_BASIS,
  };
}
