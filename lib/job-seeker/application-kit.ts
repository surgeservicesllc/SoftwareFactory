/**
 * The application kit (ADR-244): everything an applicant tracking system
 * asks for after the resume, ready to paste — and a check of a posting's
 * stated requirements against what the person has actually recorded.
 *
 * Both halves are pure functions over recorded facts. The kit copies the
 * profile into the blocks an ATS form has fields for; nothing is
 * reworded. The requirements check reads the posting's own "must" lines
 * and answers each with a verdict that names the fact it used — or says
 * plainly that no recorded fact can answer it. It never guesses that a
 * requirement is met.
 */

export const SCREENING_QUESTIONS = [
  { key: "work_authorization", label: "Are you legally authorized to work in the country of this job?", hint: "e.g. Yes — US citizen; Yes — EU work permit; No" },
  { key: "needs_sponsorship", label: "Will you now or in the future require visa sponsorship?", hint: "Yes or No, and the visa if any" },
  { key: "earliest_start", label: "Earliest start date", hint: "e.g. Immediately; 2 weeks after offer; 2026-10-01" },
  { key: "notice_period", label: "Notice period at your current employer", hint: "e.g. 30 days; none" },
  { key: "years_experience", label: "Total years of relevant experience", hint: "A number, e.g. 8" },
  { key: "education_level", label: "Highest education completed", hint: "e.g. Bachelor's, Master's, PhD, high school" },
  { key: "security_clearance", label: "Security clearance held", hint: "e.g. None; Secret (active)" },
  { key: "languages", label: "Languages you work in", hint: "e.g. English (native), Danish (fluent)" },
  { key: "willing_to_travel", label: "Willing to travel?", hint: "e.g. Up to 25%" },
  { key: "willing_to_relocate", label: "Willing to relocate?", hint: "Yes, No, or where" },
  { key: "salary_expectation", label: "Salary expectation", hint: "e.g. USD 120,000 base" },
  { key: "references", label: "References available?", hint: "e.g. Yes, on request" },
] as const;

export type ScreeningKey = (typeof SCREENING_QUESTIONS)[number]["key"];
export const SCREENING_KEYS = SCREENING_QUESTIONS.map((question) => question.key) as readonly ScreeningKey[];

export type ScreeningAnswers = Readonly<Partial<Record<ScreeningKey, string>>>;

export type KitProfile = Readonly<{
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  location: string | null;
  summary: string | null;
  skills: readonly string[];
  technologies: readonly string[];
  certifications: readonly string[];
  employmentHistory: ReadonlyArray<{
    organization: string;
    title: string;
    started?: string;
    ended?: string;
    summary?: string;
    highlights?: readonly string[];
  }>;
  education: ReadonlyArray<{
    organization: string;
    title: string;
    started?: string;
    ended?: string;
  }>;
}>;

export type KitBlock = Readonly<{ key: string; label: string; text: string }>;

/** The copy-ready blocks, in the order an ATS form usually asks for them. */
export function buildKitBlocks(profile: KitProfile, answers: ScreeningAnswers): KitBlock[] {
  const blocks: KitBlock[] = [];
  const contact = [profile.fullName, profile.email, profile.phone, profile.location, profile.linkedinUrl]
    .filter((value): value is string => Boolean(value));
  if (contact.length > 0) blocks.push({ key: "contact", label: "Contact", text: contact.join("\n") });
  if (profile.summary) blocks.push({ key: "summary", label: "Professional summary", text: profile.summary });
  if (profile.employmentHistory.length > 0) {
    blocks.push({
      key: "experience",
      label: "Work history (most recent first)",
      text: profile.employmentHistory.map((entry) => {
        const dates = [entry.started, entry.ended ?? "present"].filter(Boolean).join(" – ");
        return [
          `${entry.title} — ${entry.organization}${dates ? ` (${dates})` : ""}`,
          ...(entry.summary ? [entry.summary] : []),
          ...(entry.highlights ?? []).map((highlight) => `• ${highlight}`),
        ].join("\n");
      }).join("\n\n"),
    });
  }
  if (profile.education.length > 0) {
    blocks.push({
      key: "education",
      label: "Education",
      text: profile.education
        .map((entry) => `${entry.title} — ${entry.organization}${entry.ended ? ` (${entry.ended})` : ""}`)
        .join("\n"),
    });
  }
  const skills = [...new Set([...profile.skills, ...profile.technologies])];
  if (skills.length > 0) blocks.push({ key: "skills", label: "Skills", text: skills.join(", ") });
  if (profile.certifications.length > 0) {
    blocks.push({ key: "certifications", label: "Certifications", text: profile.certifications.join("\n") });
  }
  const answered = SCREENING_QUESTIONS
    .filter((question) => (answers[question.key] ?? "").trim().length > 0)
    .map((question) => `${question.label}\n${answers[question.key]!.trim()}`);
  if (answered.length > 0) blocks.push({ key: "screening", label: "Screening answers", text: answered.join("\n\n") });
  return blocks;
}

export type RequirementVerdict = "met" | "unmet" | "unknown";

export type RequirementCheck = Readonly<{
  line: string;
  verdict: RequirementVerdict;
  /** The recorded fact that decided it, or why nothing could. */
  reason: string;
}>;

const REQUIREMENT_SIGNAL =
  /\b(?:required|requirements?|must|minimum|at least|\d+\+?\s*(?:\+\s*)?years?|degree|bachelor|master'?s?|phd|doctorate|certif|authori[sz]ed to work|work authori[sz]ation|sponsorship|clearance|fluen(?:t|cy)|proficien(?:t|cy)|experience (?:with|in|of))\b/i;

/** The sentences of a posting that state a requirement, in order, bounded. */
export function extractRequirements(description: string | null): string[] {
  if (description === null) return [];
  const lines = description
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z•\-*])/)
    .map((line) => line.replace(/^[\s•\-*·]+/, "").trim())
    .filter((line) => line.length >= 12 && line.length <= 300 && REQUIREMENT_SIGNAL.test(line));
  return [...new Set(lines)].slice(0, 20);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

function yearOf(value: string | undefined): number | null {
  if (!value) return null;
  const match = /\b(19|20)\d{2}\b/.exec(value);
  return match === null ? null : Number(match[0]);
}

/** Years of experience the recorded history spans, when its dates say. */
export function recordedExperienceYears(history: KitProfile["employmentHistory"], now: Date = new Date()): number | null {
  const starts = history.map((entry) => yearOf(entry.started)).filter((year): year is number => year !== null);
  if (starts.length === 0) return null;
  const ends = history.map((entry) => (entry.ended ? yearOf(entry.ended) : now.getUTCFullYear()))
    .filter((year): year is number => year !== null);
  return Math.max(0, Math.max(...ends, now.getUTCFullYear()) - Math.min(...starts));
}

const YES = /^\s*(?:yes|y|true)\b/i;
const NO = /^\s*(?:no|n|false|none)\b/i;

export function checkRequirements(
  lines: readonly string[],
  profile: KitProfile,
  answers: ScreeningAnswers,
  now: Date = new Date(),
): RequirementCheck[] {
  const skillPool = [...new Set([...profile.skills, ...profile.technologies])];
  const yearsAnswer = answers.years_experience ? Number(/\d+(?:\.\d+)?/.exec(answers.years_experience)?.[0]) : NaN;
  const recordedYears = recordedExperienceYears(profile.employmentHistory, now);
  const years = Number.isFinite(yearsAnswer) ? yearsAnswer : recordedYears;
  const yearsBasis = Number.isFinite(yearsAnswer)
    ? `your screening answer (${yearsAnswer} years)`
    : recordedYears === null ? null : `your recorded history (${recordedYears} years from its dates)`;
  const educationText = normalize(profile.education.map((entry) => `${entry.title} ${entry.organization}`).join(" | "));
  const educationLevel = normalize(answers.education_level ?? "");

  return lines.map((line) => {
    const folded = normalize(line);

    // Years of experience: the posting's floor against what is recorded.
    const yearsMatch = /(\d+)\s*\+?\s*(?:or more\s*)?years?/.exec(folded);
    if (yearsMatch !== null) {
      const floor = Number(yearsMatch[1]);
      if (years === null || yearsBasis === null) {
        return { line, verdict: "unknown", reason: "No years of experience are recorded — add dates to your work history or answer the screening question." };
      }
      return years >= floor
        ? { line, verdict: "met", reason: `Asks for ${floor}+ years; ${yearsBasis} covers it.` }
        : { line, verdict: "unmet", reason: `Asks for ${floor}+ years; ${yearsBasis} falls short.` };
    }

    // Work authorization and sponsorship.
    if (/authori[sz]ed to work|work authori[sz]ation|without sponsorship|sponsorship/.test(folded)) {
      const needs = answers.needs_sponsorship ?? "";
      const authorized = answers.work_authorization ?? "";
      if (/sponsorship (?:is )?(?:available|offered|provided)|will sponsor|willing to sponsor/.test(folded)) {
        return { line, verdict: "met", reason: "The posting offers sponsorship; nothing on your side is required." };
      }
      if (NO.test(needs) && (authorized === "" || YES.test(authorized))) {
        return { line, verdict: "met", reason: `Your screening answer: sponsorship not required${YES.test(authorized) ? ", authorized to work" : ""}.` };
      }
      if (YES.test(needs) || NO.test(authorized)) {
        return { line, verdict: "unmet", reason: "Your screening answer says you need sponsorship or are not authorized." };
      }
      return { line, verdict: "unknown", reason: "Answer the work-authorization and sponsorship screening questions to check this line." };
    }

    // Security clearance.
    if (/clearance/.test(folded)) {
      const clearance = answers.security_clearance ?? "";
      if (clearance.trim() === "") return { line, verdict: "unknown", reason: "Answer the security-clearance screening question to check this line." };
      return NO.test(clearance)
        ? { line, verdict: "unmet", reason: `Your screening answer: ${clearance.trim()}.` }
        : { line, verdict: "met", reason: `Your screening answer: ${clearance.trim()}.` };
    }

    // Degrees.
    const degree = /\b(bachelor|master|mba|phd|doctorate)\b/.exec(folded);
    if (degree !== null) {
      const level = degree[1]!;
      const aliases: Record<string, RegExp> = {
        bachelor: /\b(bachelor|b\.?s\.?c?|b\.?a\.?|b\.?eng|undergraduate)\b/,
        master: /\b(master|m\.?s\.?c?|m\.?a\.?|m\.?eng|mba)\b/,
        mba: /\bmba\b/,
        phd: /\b(phd|ph\.d|doctor)/,
        doctorate: /\b(phd|ph\.d|doctor)/,
      };
      const pattern = aliases[level]!;
      if (pattern.test(educationText) || pattern.test(educationLevel)) {
        return { line, verdict: "met", reason: `Your recorded education names a ${level}'s-level qualification.` };
      }
      if (profile.education.length === 0 && educationLevel === "") {
        return { line, verdict: "unknown", reason: "No education is recorded; add it to your profile or answer the education screening question." };
      }
      return { line, verdict: "unmet", reason: `Asks for a ${level}'s-level qualification; none is recorded.` };
    }

    // Certifications.
    if (/certif/.test(folded)) {
      const named = profile.certifications.filter((certification) => folded.includes(normalize(certification)));
      if (named.length > 0) return { line, verdict: "met", reason: `Your profile records ${named.join(", ")}.` };
      if (profile.certifications.length === 0) return { line, verdict: "unknown", reason: "No certifications are recorded; add any you hold to your profile." };
      return { line, verdict: "unmet", reason: "None of your recorded certifications is named in this line." };
    }

    // Languages.
    const language = /fluen(?:t|cy) in ([a-z]+)|([a-z]+)[- ]speaking|native ([a-z]+)/.exec(folded);
    if (language !== null) {
      const wanted = (language[1] ?? language[2] ?? language[3])!;
      const spoken = normalize(answers.languages ?? "");
      if (spoken === "") return { line, verdict: "unknown", reason: "Answer the languages screening question to check this line." };
      return spoken.includes(wanted)
        ? { line, verdict: "met", reason: `Your screening answer lists ${wanted}.` }
        : { line, verdict: "unmet", reason: `Your screening answer does not list ${wanted}.` };
    }

    // Everything else: the skills and technologies the line names.
    const named = skillPool.filter((skill) => folded.includes(normalize(skill)));
    if (named.length > 0) return { line, verdict: "met", reason: `Your profile records ${named.slice(0, 5).join(", ")}.` };
    if (skillPool.length === 0) return { line, verdict: "unknown", reason: "Your profile lists no skills yet, so this line cannot be checked." };
    return { line, verdict: "unmet", reason: "None of your recorded skills or technologies appears in this line — add it to your profile if it is true." };
  });
}

/** Rows from the answers table, keyed for the evaluator. */
export function toScreeningAnswers(rows: ReadonlyArray<{ question_key: string; answer: string }>): ScreeningAnswers {
  const answers: Partial<Record<ScreeningKey, string>> = {};
  for (const row of rows) {
    if ((SCREENING_KEYS as readonly string[]).includes(row.question_key)) {
      answers[row.question_key as ScreeningKey] = row.answer;
    }
  }
  return answers;
}
