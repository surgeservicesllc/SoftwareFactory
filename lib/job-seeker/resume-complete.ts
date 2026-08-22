import {
  proposalSchema,
  type ExtractionOutcome,
  type FieldSource,
  type ProposalField,
  type ResumeProposal,
} from "@/lib/job-seeker/resume-extract";

/**
 * Filling in the fields a resume did not answer.
 *
 * Extraction is deliberately conservative — it omits a field rather than guess,
 * because a wrong employer is worse than a blank one. That leaves a profile
 * with holes, and the owner's requirement is a profile with none.
 *
 * So this is the second half: after extraction has taken everything the
 * document actually supports, whatever is still missing gets a reasoned
 * default. Every value it produces is marked `inferred`, and the review screen
 * shows that badge distinctly, because the difference between "your resume says
 * this" and "we filled this in for you" is the whole basis on which someone
 * decides what to check before they trust it.
 *
 * Nothing here fabricates career history. An employment entry or a school is a
 * verifiable claim about a person's past, and inventing one would put a lie in
 * their profile that a recruiter might read back to them. Those two fields are
 * left to the resume alone; everything else — a summary, a salary target, a
 * travel preference — is a statement of intent that the person can simply
 * correct, and a sensible starting value beats an empty box.
 */

/** What every inference is derived from. */
export type CompletionContext = Readonly<{
  /** The resume text, used as weak evidence for preferences it mentions. */
  text: string;
}>;

const REMOTE = /\bremote\b|\bwork from home\b|\bdistributed team\b/i;
const HYBRID = /\bhybrid\b/i;
const ONSITE = /\bon-?site\b|\bin-?office\b/i;
const RELOCATION = /\brelocat/i;
const TRAVEL = /\btravel\b/i;

/** The most recent employment entry, which several inferences lean on. */
function mostRecentRole(proposal: ResumeProposal): { title?: string; organization?: string } | null {
  const history = proposal.employmentHistory;
  if (!history || history.length === 0) return null;
  // Extraction preserves document order, and a resume is reverse-chronological.
  return history[0];
}

/** A currency guess from the location, defaulting to USD. */
function currencyFor(location: string | undefined): string {
  if (!location) return "USD";
  if (/\b(united kingdom|england|scotland|wales|london|manchester)\b/i.test(location)) return "GBP";
  if (/\b(germany|france|spain|italy|netherlands|ireland|portugal|berlin|paris|madrid|amsterdam|dublin)\b/i.test(location)) return "EUR";
  if (/\b(canada|toronto|vancouver|montreal|ottawa)\b/i.test(location)) return "CAD";
  if (/\b(australia|sydney|melbourne|brisbane)\b/i.test(location)) return "AUD";
  if (/\b(india|bangalore|bengaluru|mumbai|delhi|hyderabad)\b/i.test(location)) return "INR";
  return "USD";
}

/**
 * A salary target, in the local currency, from seniority.
 *
 * Deliberately round numbers: these are placeholders a person is expected to
 * replace, and a precise-looking figure would imply a calculation that did not
 * happen. Scaled per currency because 180,000 means very different things in
 * USD and INR.
 */
function salaryFor(title: string | undefined, currency: string): number {
  const seniority = /\b(chief|vp|vice president|head of|director)\b/i.test(title ?? "")
    ? 3
    : /\b(principal|staff|lead|architect)\b/i.test(title ?? "")
      ? 2
      : /\b(senior|sr\.?)\b/i.test(title ?? "")
        ? 1
        : 0;
  const base: Record<string, readonly number[]> = {
    USD: [110_000, 150_000, 190_000, 240_000],
    GBP: [65_000, 90_000, 115_000, 145_000],
    EUR: [70_000, 95_000, 120_000, 150_000],
    CAD: [100_000, 130_000, 165_000, 200_000],
    AUD: [120_000, 155_000, 190_000, 230_000],
    INR: [1_800_000, 3_000_000, 4_500_000, 6_500_000],
  };
  return (base[currency] ?? base.USD)[seniority];
}

/** A summary written only from facts the profile already holds. */
function summaryFrom(proposal: ResumeProposal): string | null {
  const role = mostRecentRole(proposal);
  const skills = (proposal.skills ?? []).slice(0, 4);
  const technologies = (proposal.technologies ?? []).slice(0, 3);
  const named = [...new Set([...skills, ...technologies])];

  if (!role?.title && named.length === 0) return null;

  const opening = role?.title
    ? role.organization
      ? `${role.title} at ${role.organization}.`
      : `${role.title}.`
    : "Experienced practitioner.";
  const tail = named.length > 0 ? ` Works with ${named.join(", ")}.` : "";
  // Only restates what is already recorded — no claim the profile cannot support.
  return `${opening}${tail}`.slice(0, 4000);
}

/**
 * Industries guessed from employer names and technologies.
 *
 * Weak by nature, which is exactly why it is `inferred`. A person who works at
 * a bank and a person who writes software for one both look the same here.
 */
function industriesFrom(proposal: ResumeProposal, text: string): string[] {
  const haystack = [
    text,
    ...(proposal.employmentHistory ?? []).map((entry) => entry.organization),
  ]
    .join(" ")
    .toLowerCase();

  const found = [
    [/\b(bank|fintech|payments?|trading|insurance|capital)\b/, "Financial Services"],
    [/\b(health|medical|clinical|patient|pharma|biotech)\b/, "Healthcare"],
    [/\b(retail|commerce|marketplace|storefront|shopping)\b/, "Retail and E-commerce"],
    [/\b(education|university|school|learning|edtech)\b/, "Education"],
    [/\b(government|public sector|civic|municipal)\b/, "Public Sector"],
    [/\b(games?|gaming|entertainment|media|streaming)\b/, "Media and Entertainment"],
    [/\b(logistics|supply chain|freight|shipping)\b/, "Logistics"],
    [/\b(energy|utilities|solar|grid)\b/, "Energy"],
  ].filter(([pattern]) => (pattern as RegExp).test(haystack))
    .map(([, label]) => label as string);

  // Software is the safe floor: the profile has to say something, and every
  // resume this feature reads is a resume someone is using to apply for work.
  return found.length > 0 ? found.slice(0, 50) : ["Software"];
}

/**
 * Take a proposal as far as it can honestly go, then fill the rest.
 *
 * Returns the same shape extraction returns, so callers cannot tell the two
 * apart structurally — the distinction lives in `sources`, which is where it
 * belongs.
 */
export function completeProposal(
  outcome: ExtractionOutcome,
  context: CompletionContext,
): ExtractionOutcome {
  const proposal: Record<string, unknown> = { ...outcome.proposal };
  const sources: Partial<Record<ProposalField, FieldSource>> = { ...outcome.sources };

  const infer = <K extends ProposalField>(field: K, value: ResumeProposal[K] | null | undefined) => {
    // Never overwrite something the resume actually supported.
    if (proposal[field] !== undefined) return;
    if (value === null || value === undefined) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === "string" && value.trim().length === 0) return;
    proposal[field] = value;
    sources[field] = "inferred" as FieldSource;
  };

  const text = context.text;
  const current = proposalSchema.parse(proposal);

  // Contact details cannot be invented: an email or a phone number that is not
  // the person's is worse than useless, since it would be written into
  // documents sent on their behalf. Left blank when the resume has none.

  infer("summary", summaryFrom(current) ?? undefined);

  const skills = current.skills ?? [];
  const technologies = current.technologies ?? [];
  // A resume with one combined list gets it mirrored rather than left half
  // empty; the person can split them, and an empty column helps nobody.
  infer("skills", technologies.length > 0 ? technologies.slice(0, 200) : undefined);
  infer("technologies", skills.length > 0 ? skills.slice(0, 200) : undefined);

  /*
   * Certifications are left alone deliberately. "AWS Solutions Architect" is a
   * credential that either exists or does not, and a plausible-looking one in
   * someone's profile is a claim a recruiter can check and they cannot defend.
   * Same reasoning as employment history and education below.
   */
  infer("industries", industriesFrom(current, text));

  // Accomplishments from the highlights already recorded under employment —
  // restating stored facts, not inventing new ones.
  const highlights = (current.employmentHistory ?? [])
    .flatMap((entry) => entry.highlights ?? [])
    .filter((line) => line.trim().length > 0)
    .slice(0, 100);
  infer("accomplishments", highlights.length > 0 ? highlights : undefined);

  const arrangement = HYBRID.test(text)
    ? "hybrid"
    : REMOTE.test(text)
      ? "remote"
      : ONSITE.test(text)
        ? "onsite"
        : "any";
  infer("workArrangement", arrangement);

  infer("openToRelocation", RELOCATION.test(text));
  infer("openToTravel", TRAVEL.test(text));

  const currency = currencyFor(current.location);
  infer("salaryCurrency", currency);
  infer("salaryTarget", salaryFor(mostRecentRole(current)?.title, currency));

  return { proposal: proposalSchema.parse(proposal), sources };
}

/** The fields a completed profile is expected to carry, for the UI's count. */
export const COMPLETABLE_FIELDS: readonly ProposalField[] = [
  "fullName",
  "email",
  "phone",
  "linkedinUrl",
  "location",
  "summary",
  "employmentHistory",
  "education",
  "accomplishments",
  "skills",
  "certifications",
  "technologies",
  "industries",
  "salaryTarget",
  "salaryCurrency",
  "workArrangement",
  "openToTravel",
  "openToRelocation",
];
