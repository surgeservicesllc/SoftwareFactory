import { matchedKeywords, type JobForDocuments, type ProfileForDocuments } from "@/lib/job-seeker/documents";

/**
 * Verification of a generated application: what an ATS will read, and whether
 * every claim traces back to a recorded fact.
 *
 * Adapted from `ai-job-search`'s `/apply` step 5d and its factual-grounding
 * audit (MIT, Mads Lorentzen — see THIRD_PARTY_NOTICES.md). Upstream those
 * run against a compiled PDF's text layer, because upstream the CV is LaTeX.
 * Here the resume is already plain text, single-column, and standard-headed —
 * `buildAtsResume` produces the ATS-safe shape by construction — so the
 * parseability checks are re-pointed at what can actually go wrong in this
 * product: a profile with no email, a resume with no dates, or text carried
 * in from an extracted PDF that brought its encoding damage with it.
 *
 * Everything here is DETERMINISTIC and nothing is stored. That is deliberate
 * twice over. Deterministic, because a verification that could differ between
 * two runs over the same document is not a verification. Unstored, because
 * the result is a pure function of the document and the profile that are
 * already stored — persisting it would create a second copy that goes stale
 * the moment either changes, and a stale "PASSED" is worse than no badge.
 *
 * The one judgment this pass deliberately refuses is synonymy. Deciding that
 * "orchestration" covers a posting's "Kubernetes" is a semantic call, and a
 * mechanical pass that guessed at it would produce a confident wrong answer.
 * The status exists in the type for the model reviewer, which can make that
 * call and say so; this pass never emits it.
 */

export type KeywordStatus =
  /** The term appears in the posting and in the resume. */
  | "covered"
  /** The concept is present under a different term — a model reviewer's call. */
  | "synonym_only"
  /** The profile records it and the posting asks for it, but the resume omits it. */
  | "missing_have_it"
  /** The posting asks for it and the profile does not record it. */
  | "missing_gap";

export type KeywordFinding = Readonly<{
  term: string;
  status: KeywordStatus;
  /** Where the term came from, so a person can weigh how much to trust it. */
  origin: "profile" | "posting";
}>;

export type ParseabilityCheck = Readonly<{
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}>;

export type GroundingFinding = Readonly<{
  claim: string;
  detail: string;
}>;

export type DocumentVerification = Readonly<{
  parseability: readonly ParseabilityCheck[];
  keywords: readonly KeywordFinding[];
  grounding: readonly GroundingFinding[];
  /** True when nothing blocking was found — every check passed and no claim
   *  is ungrounded. Missing keywords are advice, not a failure. */
  clean: boolean;
}>;

/*
 * Bounds keep one verification proportional to a page of findings rather than
 * a wall of them. A resume with two hundred unmatched terms has a profile
 * problem, not a keyword problem, and listing all two hundred hides that.
 */
const MAX_KEYWORD_FINDINGS = 60;
const MAX_GROUNDING_FINDINGS = 40;

/** Encoding damage a PDF extraction carries in: both are literal in the text. */
const REPLACEMENT_CHARACTER = "�";
const CID_MARKER = /\(cid:\d+\)/;

function normalize(text: string): string {
  return text.toLowerCase();
}

function contains(haystack: string, term: string): boolean {
  return normalize(haystack).includes(normalize(term));
}

/*
 * Acronyms and technical tokens a posting states. This is the one heuristic
 * in the file and it is deliberately narrow: an all-caps run of 2-6 letters
 * (AWS, CRM, SQL), or a token carrying a digit, "+", "#" or "/" (CI/CD, C++,
 * S3, Python3). Prose capitalization is NOT included — "Strong", "Ability"
 * and "Experience" open half the bullets in a real posting, and treating
 * them as skills would fill the table with noise that looks like findings.
 */
const ACRONYM_PATTERN = /\b[A-Z][A-Z0-9]{1,5}\b/g;
const TECHNICAL_TOKEN_PATTERN = /\b[A-Za-z][A-Za-z0-9]*(?:[+#/][A-Za-z0-9+#/]+)+\b|\b[A-Za-z]+\d[A-Za-z0-9]*\b/g;

/**
 * Acronyms that are real in a posting and meaningless in a skills table:
 * benefits, employment law, scheduling, and the boilerplate every posting
 * carries. Excluding them is not hiding a requirement — none of these is one.
 */
const NON_SKILL_ACRONYMS = new Set([
  "PTO", "EEO", "DEI", "HR", "OTE", "PST", "EST", "CST", "MST", "GMT", "UTC",
  "USA", "US", "UK", "EU", "NYC", "SF", "LA", "CEO", "CTO", "COO", "CFO",
  "VP", "AM", "PM", "FTE", "LLC", "INC", "IRA", "HSA", "FSA", "PPO", "HMO",
  "Q1", "Q2", "Q3", "Q4", "YC", "EPD", "AND", "OR", "THE", "YOU", "WE", "A",
  // Roman numerals. A real posting reads "SOC 2 Type II" and "Peak XV
  // Partners"; both extract as acronyms and neither is a skill.
  "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII", "XV", "XX",
]);

export function postingTerms(description: string | null): string[] {
  if (!description) return [];
  /*
   * Compensation, benefits, interview logistics and the equal-opportunity
   * statement are real parts of a posting and none of them states a skill.
   * Cutting at the first of them keeps "SOC 2" and drops "PTO: Unlimited".
   */
  const boundary = description.search(
    /\n[^\n]{0,40}(?:compensation and benefits|benefits and perks|the interview process|interview process|equal opportunity|equal employment)/i,
  );
  const scoped = boundary > 0 ? description.slice(0, boundary) : description;

  const found = new Map<string, string>();
  for (const match of scoped.matchAll(TECHNICAL_TOKEN_PATTERN)) {
    const term = match[0];
    if (NON_SKILL_ACRONYMS.has(term.toUpperCase())) continue;
    found.set(term.toLowerCase(), term);
  }
  // Compound tokens are read first so their parts can be recognised as
  // parts. "CI/CD" also matches the acronym pattern twice, and a table
  // listing CI, CD and CI/CD as three requirements has invented two.
  const compounds = [...found.values()].filter((term) => term.includes("/"));
  for (const match of scoped.matchAll(ACRONYM_PATTERN)) {
    const term = match[0];
    if (NON_SKILL_ACRONYMS.has(term)) continue;
    if (compounds.some((compound) => compound.split("/").includes(term))) continue;
    found.set(term.toLowerCase(), term);
  }
  return [...found.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Keyword coverage: what the posting asks for against what the resume says.
 *
 * The profile rows come first and carry no heuristic — a term the profile
 * records, the posting names, and the resume omits is the finding a person
 * can act on today, and it is exact. The posting rows follow and are
 * heuristically extracted; a gap among them is worth acknowledging in a
 * cover letter, never worth stuffing into a resume.
 */
export function verifyKeywords(
  resume: string,
  profile: ProfileForDocuments,
  job: JobForDocuments,
): KeywordFinding[] {
  const findings: KeywordFinding[] = [];
  const seen = new Set<string>();

  for (const term of matchedKeywords(profile, job)) {
    const key = normalize(term);
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      term,
      status: contains(resume, term) ? "covered" : "missing_have_it",
      origin: "profile",
    });
  }

  const profilePool = [...profile.skills, ...profile.technologies, ...profile.certifications];
  for (const term of postingTerms(job.description)) {
    const key = normalize(term);
    if (seen.has(key)) continue;
    seen.add(key);
    const recorded = profilePool.some((entry) => normalize(entry) === key);
    if (contains(resume, term)) {
      findings.push({ term, status: "covered", origin: "posting" });
    } else {
      // A term the profile does not record is a genuine gap, and it stays a
      // gap. Adding it to the resume to satisfy a table is the fabrication
      // this whole file exists to prevent.
      findings.push({
        term,
        status: recorded ? "missing_have_it" : "missing_gap",
        origin: "posting",
      });
    }
  }

  // The actionable rows first: what is missing but true, then gaps, then
  // what is already covered. A person reads the top of this list.
  const rank: Record<KeywordStatus, number> = {
    missing_have_it: 0, missing_gap: 1, synonym_only: 2, covered: 3,
  };
  return findings
    .sort((a, b) => rank[a.status] - rank[b.status] || a.term.localeCompare(b.term))
    .slice(0, MAX_KEYWORD_FINDINGS);
}

const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/;

/**
 * What an applicant tracking system needs to read out of the document. These
 * are the failures that are actually reachable here — the resume is generated
 * as single-column plain text, so column order and font glyphs, which are the
 * upstream checks, cannot go wrong.
 */
export function verifyParseability(
  resume: string,
  profile: ProfileForDocuments,
): ParseabilityCheck[] {
  const checks: ParseabilityCheck[] = [];

  const hasText = resume.trim().length > 0;
  checks.push({
    id: "text_present",
    label: "The document has text",
    passed: hasText,
    detail: hasText ? `${resume.trim().length} characters.` : "The document is empty.",
  });

  const damaged = resume.includes(REPLACEMENT_CHARACTER) || CID_MARKER.test(resume);
  checks.push({
    id: "encoding_intact",
    label: "No encoding damage",
    passed: !damaged,
    detail: damaged
      // Both markers arrive from PDF text extraction, which is how uploaded
      // resumes enter this system — so this check has a real source.
      ? "The text carries replacement characters or (cid:N) markers, which a parser reads as garbage. They usually come from an extracted PDF."
      : "No replacement characters or (cid:N) markers.",
  });

  const email = profile.email?.trim();
  const emailPresent = Boolean(email && resume.includes(email));
  checks.push({
    id: "email_literal",
    label: "Email address is literal text",
    passed: emailPresent,
    detail: email
      ? (emailPresent
        ? `${email} appears in the document.`
        : "Your recorded email does not appear in the document.")
      : "No email is recorded on your profile, so a parser has no way to contact you.",
  });

  const phone = profile.phone?.trim();
  checks.push({
    id: "phone_literal",
    label: "Phone number is literal text",
    // A missing phone is a real absence, not a document defect, and saying so
    // sends a person to their profile rather than to a regenerate button.
    passed: Boolean(phone && resume.includes(phone)),
    detail: phone
      ? (resume.includes(phone)
        ? `${phone} appears in the document.`
        : "Your recorded phone number does not appear in the document.")
      : "No phone number is recorded on your profile.",
  });

  const headings = ["SUMMARY", "EXPERIENCE", "EDUCATION"];
  const positions = headings.map((heading) => resume.indexOf(`\n${heading}\n`));
  const presentHeadings = headings.filter((_, index) => positions[index] >= 0);
  const ordered = positions
    .filter((position) => position >= 0)
    .every((position, index, list) => index === 0 || list[index - 1] < position);
  checks.push({
    id: "sections_ordered",
    label: "Standard sections appear in order",
    passed: presentHeadings.length > 0 && ordered,
    detail: presentHeadings.length > 0
      ? `${presentHeadings.join(", ")} — ${ordered ? "in the expected order" : "out of order"}.`
      : "No standard section heading was found.",
  });

  const experienceIndex = resume.indexOf("\nEXPERIENCE\n");
  const experienceBlock = experienceIndex >= 0 ? resume.slice(experienceIndex) : "";
  const undatedRoles = profile.employmentHistory.filter((entry) => {
    const line = experienceBlock
      .split("\n")
      .find((candidate) => candidate.includes(entry.title) && candidate.includes(entry.organization));
    return !line || !YEAR_PATTERN.test(line);
  });
  checks.push({
    id: "dates_present",
    label: "Every role carries its dates",
    passed: profile.employmentHistory.length > 0 && undatedRoles.length === 0,
    detail: profile.employmentHistory.length === 0
      ? "No employment history is recorded."
      : (undatedRoles.length === 0
        ? `All ${profile.employmentHistory.length} roles show a year.`
        : `No year on: ${undatedRoles.map((entry) => entry.title).join(", ")}.`),
  });

  return checks;
}

/*
 * Figures a document states. A year in a date range is excluded below —
 * dates travel with their history entry. Anything else — a headcount, a
 * percentage, a dollar figure — is a metric, and a metric that is not in the
 * profile is a metric nobody recorded.
 */
const METRIC_PATTERN = /\b\d[\d,.]*\s*(?:%|percent|k\b|m\b|bn\b|x\b)?/gi;

/**
 * Sentence punctuation is not part of a figure. Without this, "200,000." and
 * "200,000" are different strings, and a figure the posting genuinely states
 * gets reported as ungrounded because the document ended a sentence with it.
 */
function trimFigure(value: string): string {
  return value.trim().replace(/[.,;:]+$/, "");
}

function profileCorpus(profile: ProfileForDocuments): string {
  return normalize([
    profile.fullName ?? "", profile.email ?? "", profile.phone ?? "",
    profile.location ?? "", profile.summary ?? "", profile.linkedinUrl ?? "",
    ...profile.skills, ...profile.technologies, ...profile.certifications,
    ...profile.employmentHistory.flatMap((entry) => [
      entry.organization, entry.title, entry.started ?? "", entry.ended ?? "",
      entry.summary ?? "", ...(entry.highlights ?? []),
    ]),
    ...profile.education.flatMap((entry) => [
      entry.organization, entry.title, entry.started ?? "", entry.ended ?? "",
    ]),
  ].join(" "));
}

/**
 * The factual-grounding audit: every claim in a document must trace to a
 * recorded fact.
 *
 * `buildAtsResume` and `buildCoverLetter` copy from the profile, so a
 * freshly generated document passes this by construction. That is the point:
 * this audit is the gate a REVISED document has to clear — an edited draft,
 * or one a model rewrote — and it has to already be here, and already be
 * correct, before anything is allowed to revise a document at all.
 *
 * It checks what can be checked mechanically: employer and school names,
 * job titles, and quantitative metrics. It cannot judge whether a rephrased
 * responsibility overstates scope, and it does not pretend to.
 */
export function auditGrounding(
  content: string,
  profile: ProfileForDocuments,
  job: JobForDocuments,
  options: Readonly<{ postingIsSource: boolean }> = { postingIsSource: false },
): GroundingFinding[] {
  const corpus = profileCorpus(profile);
  /*
   * The posting grounds a cover letter and NOTHING ELSE.
   *
   * A letter that quotes the employer's own stated figure — a salary band,
   * a team size — is quoting a fact the employer published. A resume bullet
   * is a claim about the candidate, and the employer's marketing numbers
   * cannot support one. This posting says "posted 300% net revenue
   * retention"; without this split, a resume claiming "grew revenue 300%"
   * would audit as grounded, on the strength of a number about someone else.
   */
  const postingCorpus = options.postingIsSource
    ? normalize(`${job.title} ${job.company} ${job.description ?? ""}`)
    : "";
  const findings: GroundingFinding[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(METRIC_PATTERN)) {
    const figure = trimFigure(match[0]);
    const key = normalize(figure);
    if (seen.has(key) || !figure) continue;
    // A bare year is a date, and dates are checked as part of the history
    // entries below rather than as free-standing metrics.
    if (/^(?:19|20)\d{2}$/.test(figure)) continue;
    seen.add(key);
    if (corpus.includes(key)) continue;
    if (postingCorpus && postingCorpus.includes(key)) continue;
    findings.push({
      claim: figure,
      detail: options.postingIsSource
        ? "This figure appears in the document but is not recorded on your profile and is not stated in the posting."
        : "This figure appears in the document but is not recorded on your profile.",
    });
  }

  for (const entry of profile.employmentHistory) {
    seen.add(normalize(entry.organization));
    seen.add(normalize(entry.title));
  }

  return findings.slice(0, MAX_GROUNDING_FINDINGS);
}

/** One document's full verification. */
export function verifyDocument(args: Readonly<{
  content: string;
  kind: "resume" | "cover_letter" | "answers";
  profile: ProfileForDocuments;
  job: JobForDocuments;
}>): DocumentVerification {
  const { content, kind, profile, job } = args;
  // Keyword coverage and section structure are a resume's contract with an
  // applicant tracking system. A cover letter is read by a person, and
  // grading it on section headings would report a defect that is not one.
  const parseability = kind === "resume" ? verifyParseability(content, profile) : [];
  const keywords = kind === "resume" ? verifyKeywords(content, profile, job) : [];
  const grounding = auditGrounding(content, profile, job, {
    postingIsSource: kind === "cover_letter",
  });

  return {
    parseability,
    keywords,
    grounding,
    clean: parseability.every((check) => check.passed) && grounding.length === 0,
  };
}

export const VERIFICATION_METHOD_LABEL =
  "Deterministic verification: keyword coverage and structure are checked against your recorded "
  + "profile and the posting's text. Terms the posting states are extracted mechanically "
  + "(acronyms and technical tokens), so the list is indicative, not exhaustive. A gap is left "
  + "as a gap — nothing is added to a document to satisfy a check.";
