import { postingTerms } from "@/lib/job-seeker/verification";

/**
 * What the roles on your board keep asking for, and which of it your profile
 * records.
 *
 * Adapted from `ai-job-search`'s `/upskill` (MIT, Mads Lorentzen — see
 * THIRD_PARTY_NOTICES.md). Upstream reads a CSV of applications and reasons
 * about fit ratings; here the input is the postings already recorded against
 * this person, so every row traces to a posting they can open.
 *
 * Nothing here consults a market, a salary survey, or a model. A term is
 * "in demand" because postings on THIS board name it, and the count says how
 * many. That is a narrower claim than "the industry wants this" and it is the
 * only one the data supports — so the count travels with every row and the
 * surface says what the sample is.
 *
 * The ordering is what makes it useful rather than merely true. A gap that
 * appears in roles you score well against is worth learning; the same gap in
 * roles you would never take is noise. So demand is weighted by the match
 * scores of the postings that carry it, not by raw frequency.
 *
 * The two halves are found differently, and the asymmetry is deliberate.
 * A STRENGTH is exact: the profile states the term, and the posting text
 * either contains it or does not. A GAP goes through `postingTerms`, which
 * is a bounded heuristic — so the strengths column is never wrong, and the
 * gaps column is labelled as indicative. Running both through the extractor
 * would have made a recorded skill it does not know about, like a niche
 * framework, silently vanish from a person's own strengths.
 */

export type PostingForGapAnalysis = Readonly<{
  title: string;
  company: string;
  description: string | null;
  /** The stored match score, when the posting has one. */
  score: number | null;
}>;

export type SkillDemand = Readonly<{
  term: string;
  /** Postings on this board that name it. The sample, stated. */
  postings: number;
  /** Whether the recorded profile carries it. */
  recorded: boolean;
  /** Mean match score of the postings naming it, or null when none is scored. */
  averageScore: number | null;
  /** Up to three roles that asked for it, so a row can be traced. */
  examples: readonly string[];
}>;

export type SkillGapModel = Readonly<{
  /** Postings with a description this could actually read. */
  analysed: number;
  /** Postings with no description — counted, never quietly dropped. */
  skipped: number;
  gaps: readonly SkillDemand[];
  strengths: readonly SkillDemand[];
  /** Fraction of demanded terms the profile records, or null with no sample. */
  coverage: number | null;
}>;

/** A row on one posting is noise; the surface should not present it as a trend. */
const MIN_POSTINGS_FOR_A_ROW = 2;
const MAX_ROWS = 40;
const MAX_EXAMPLES = 3;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Weight a term by the postings that carry it AND how well they fit.
 *
 * Frequency alone ranks the terms in the roles you happened to save most of,
 * which is usually the ones you were least selective about. Multiplying by
 * mean fit moves a term that shows up in your strongest matches above one
 * that shows up twice as often in roles you scored 20 against.
 */
function weight(demand: SkillDemand): number {
  const fit = demand.averageScore === null ? 0.5 : demand.averageScore / 100;
  return demand.postings * (0.25 + fit);
}

export function analyseSkillGaps(
  postings: readonly PostingForGapAnalysis[],
  profileTerms: readonly string[],
): SkillGapModel {
  const recorded = new Set(profileTerms.map(normalize).filter(Boolean));

  type Accumulator = {
    term: string;
    postings: number;
    scoreTotal: number;
    scoreCount: number;
    examples: string[];
  };
  const byTerm = new Map<string, Accumulator>();

  let analysed = 0;
  let skipped = 0;
  for (const posting of postings) {
    if (!posting.description?.trim()) {
      // A posting recorded by hand with no body cannot be read for terms.
      // Counting it keeps the sample honest — the coverage figure below is
      // over `analysed`, not over everything on the board.
      skipped += 1;
      continue;
    }
    analysed += 1;
    // One posting counts once per term however many times it repeats it, and
    // the extractor runs once per posting rather than once per term.
    const seen = new Map<string, string>();
    for (const term of postingTerms(posting.description)) {
      const key = normalize(term);
      if (!seen.has(key)) seen.set(key, term);
    }
    // A recorded skill the posting names counts even when the extractor does
    // not know the term. This side needs no heuristic: the profile says what
    // to look for and the posting either says it or does not.
    const haystack = normalize(`${posting.title} ${posting.description}`);
    for (const term of profileTerms) {
      const key = normalize(term);
      if (!key || seen.has(key)) continue;
      if (haystack.includes(key)) seen.set(key, term.trim());
    }
    for (const [term, original] of seen) {
      const entry = byTerm.get(term) ?? {
        term: original, postings: 0, scoreTotal: 0, scoreCount: 0, examples: [],
      };
      entry.postings += 1;
      if (posting.score !== null) {
        entry.scoreTotal += posting.score;
        entry.scoreCount += 1;
      }
      if (entry.examples.length < MAX_EXAMPLES) {
        entry.examples.push(`${posting.title} — ${posting.company}`);
      }
      byTerm.set(term, entry);
    }
  }

  const demand: SkillDemand[] = [...byTerm.entries()]
    .filter(([, entry]) => entry.postings >= MIN_POSTINGS_FOR_A_ROW)
    .map(([key, entry]) => ({
      term: entry.term,
      postings: entry.postings,
      recorded: recorded.has(key),
      averageScore: entry.scoreCount > 0
        ? Math.round(entry.scoreTotal / entry.scoreCount)
        : null,
      examples: entry.examples,
    }));

  const ranked = [...demand].sort((a, b) =>
    weight(b) - weight(a) || a.term.localeCompare(b.term));

  const gaps = ranked.filter((row) => !row.recorded).slice(0, MAX_ROWS);
  const strengths = ranked.filter((row) => row.recorded).slice(0, MAX_ROWS);

  return {
    analysed,
    skipped,
    gaps,
    strengths,
    // Null rather than 0 or 100 with no sample: "nothing to measure" is a
    // different fact from "you cover none of it".
    coverage: demand.length > 0
      ? Math.round((demand.filter((row) => row.recorded).length / demand.length) * 100)
      : null,
  };
}

export const SKILL_GAP_METHOD_LABEL =
  "Counted from the postings on your own board, not from a market survey. A term is listed "
  + "because at least two of your recorded postings name it, and the count says how many. "
  + "Rows are ordered by how well the roles asking for them match your profile, so a gap in "
  + "your strongest matches ranks above a more common one in roles you scored low against. "
  + "Strengths are exact — your recorded skill either appears in the posting or does not. "
  + "Gaps come from acronyms, technical tokens and a known-technology list, so that column is "
  + "indicative rather than exhaustive.";
