import { z } from "zod";

/**
 * Turning resume text into proposed profile fields.
 *
 * Two extractors, one output. The deterministic pass always runs and finds what
 * patterns can find reliably — an address, a phone number, a section list. The
 * model pass runs when a provider credential is configured and reads the things
 * patterns are bad at: which line is the employer and which is the job title,
 * what a bullet is actually claiming, whether "Michigan" is a school or a place.
 *
 * Neither pass writes anything. Both produce a *proposal* that a person
 * confirms, because this is their career history and a confident wrong answer
 * about where someone worked is worse than an empty field. Provenance travels
 * with every field so the review screen can say which pass produced it.
 *
 * The validation below is not a formality: it mirrors the CHECK constraints in
 * migration 20260820000200 exactly. A proposal that this module accepts is one
 * the database will accept, so a person can never be shown a suggestion that
 * fails on apply.
 */

// ---------------------------------------------------------------------------
// The shape, bounded exactly as the database bounds it
// ---------------------------------------------------------------------------

/** `job_seeker_text_list_valid(list, maxItems, maxLength)`, in TypeScript. */
function textList(maxItems: number, maxLength: number) {
  return z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);
}

/** `job_seeker_history_valid`, in TypeScript — allowlisted keys included. */
const historyEntrySchema = z
  .object({
    organization: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    started: z.string().trim().min(1).max(40).optional(),
    ended: z.string().trim().min(1).max(40).optional(),
    summary: z.string().trim().max(2000).optional(),
    highlights: textList(20, 500).optional(),
  })
  .strict();

export const historySchema = z.array(historyEntrySchema).max(40);

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/**
 * Everything a resume can propose. Every field is optional: an extractor that
 * found nothing for a field must omit it rather than propose an empty value,
 * because a blank suggestion that overwrites a filled-in profile field is a
 * silent deletion.
 */
export const proposalSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().min(3).max(320).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
    linkedinUrl: z.string().trim().regex(/^https:\/\//).max(400).optional(),
    location: z.string().trim().min(1).max(200).optional(),
    summary: z.string().trim().min(1).max(4000).optional(),
    employmentHistory: historySchema.optional(),
    education: historySchema.optional(),
    accomplishments: textList(100, 500).optional(),
    skills: textList(200, 120).optional(),
    certifications: textList(100, 200).optional(),
    technologies: textList(200, 120).optional(),
    industries: textList(50, 120).optional(),
  })
  .strict();

export type ResumeProposal = z.infer<typeof proposalSchema>;
export type ProposalField = keyof ResumeProposal;
export type FieldSource = "pattern" | "model";

export type ExtractionOutcome = Readonly<{
  proposal: ResumeProposal;
  /** Which pass produced each proposed field, for the review screen. */
  sources: Readonly<Partial<Record<ProposalField, FieldSource>>>;
}>;

// ---------------------------------------------------------------------------
// Deterministic extraction
// ---------------------------------------------------------------------------

const SECTION_VOCABULARY: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(professional\s+)?summary$|^profile$|^objective$|^about( me)?$/i, "summary"],
  [/^(work|professional|employment)?\s*experience$|^work history$|^employment$/i, "experience"],
  [/^education$|^academic background$/i, "education"],
  [/^technical skills$|^technologies$|^tools?( ?& ?technologies)?$|^tech stack$/i, "technologies"],
  [/^skills$|^core competencies$|^competencies$|^areas of expertise$/i, "skills"],
  [/^certifications?$|^licenses? (and|&) certifications?$/i, "certifications"],
  [/^industries$|^domains?$/i, "industries"],
  [/^(key )?(accomplishments|achievements)$|^awards$|^highlights$/i, "accomplishments"],
];

/** Section headings are short, unpunctuated, and on a line of their own. */
function sectionKeyFor(line: string): string | null {
  const candidate = line.replace(/[:•\-–—\s]+$/u, "").trim();
  if (candidate.length === 0 || candidate.length > 60) return null;
  for (const [pattern, key] of SECTION_VOCABULARY) {
    if (pattern.test(candidate)) return key;
  }
  return null;
}

type Sections = Readonly<{ preamble: string[]; sections: ReadonlyMap<string, string[]> }>;

function splitSections(text: string): Sections {
  const preamble: string[] = [];
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const key = sectionKeyFor(line);
    if (key !== null) {
      // A heading repeated later appends rather than replaces, so a
      // two-column layout that interleaves sections does not lose half of one.
      current = sections.get(key) ?? [];
      sections.set(key, current);
      continue;
    }
    if (line.length === 0) continue;
    (current ?? preamble).push(line);
  }
  return { preamble, sections };
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const LINKEDIN = /https?:\/\/(?:[\w-]+\.)?linkedin\.com\/[\w\-/%.]+/i;
/**
 * Phone numbers, deliberately narrow. It requires either a leading `+` or
 * bracketed/separated groups, so a year range like "2017 - 2021" and a
 * six-figure salary cannot be read as a phone number — the two false positives
 * a looser pattern actually produces on resumes.
 */
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})?/;
/** "Oakland, CA" or "Berlin, Germany" — a comma with words on both sides. */
const LOCATION = /^([A-Z][\p{L}.'-]+(?:[ \t][A-Z][\p{L}.'-]+)*),[ \t]*([A-Z]{2}|[A-Z][\p{L}.'-]+(?:[ \t][A-Z][\p{L}.'-]+)*)$/u;

function looksLikeName(line: string): boolean {
  if (line.length < 3 || line.length > 80) return false;
  if (EMAIL.test(line) || /\d/.test(line) || line.includes("@")) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  // Allows "Dana Okafor", "Ana María Ruiz-Peña", "J. R. Patel".
  return words.every((word) => /^[\p{Lu}][\p{L}.'-]*$/u.test(word));
}

function splitList(lines: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const line of lines) {
    for (const piece of line.split(/[,;|•]|\s{2,}|\s\/\s/)) {
      const item = piece.replace(/^[\s•\-–—]+|[\s.]+$/gu, "").trim();
      if (item.length === 0 || item.length > 120) continue;
      const key = item.toLowerCase();
      if (!seen.has(key)) seen.set(key, item);
    }
  }
  return [...seen.values()];
}

const DATE_RANGE =
  /\(?\b((?:[A-Z][a-z]{2,8}\.?\s+)?(?:19|20)\d{2})\s*[-–—]{1,2}\s*((?:[A-Z][a-z]{2,8}\.?\s+)?(?:19|20)\d{2}|present|current|now)\b\)?/i;
/** "Title — Organization" or "Organization — Title", the two common orders. */
const TITLE_ORG = /^(.{2,120}?)\s+[—–]\s+(.{2,120}?)$/;

/**
 * Employment and education entries.
 *
 * Deliberately conservative: an entry is only emitted when a line yields BOTH
 * an organization and a title. A resume line this cannot confidently split is
 * left for the model pass or for the person, rather than guessed at — a wrong
 * employer is worse than a blank field, and this is the one place where a
 * plausible-looking mistake would be hardest for someone to spot while
 * skimming a review screen.
 */
function parseHistory(lines: readonly string[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let current: { organization: string; title: string; started?: string; ended?: string; highlights: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const entry: HistoryEntry = {
      organization: current.organization.slice(0, 200),
      title: current.title.slice(0, 200),
      ...(current.started ? { started: current.started.slice(0, 40) } : {}),
      ...(current.ended ? { ended: current.ended.slice(0, 40) } : {}),
      ...(current.highlights.length > 0
        ? { highlights: current.highlights.slice(0, 20).map((h) => h.slice(0, 500)) }
        : {}),
    };
    entries.push(entry);
    current = null;
  };

  for (const line of lines) {
    const bullet = /^[•\-–—*]\s*(.+)$/u.exec(line);
    if (bullet && current) {
      current.highlights.push(bullet[1].trim());
      continue;
    }

    const dates = DATE_RANGE.exec(line);
    const withoutDates = dates ? line.replace(dates[0], "").trim() : line;
    const pair = TITLE_ORG.exec(withoutDates.replace(/[,\s]+$/u, ""));
    if (!pair) {
      /*
       * An unbulleted achievement line under an open entry.
       *
       * Word does not put bullet characters in the text: a bulleted list is
       * numbering metadata on the paragraph, so `word/document.xml` holds the
       * sentence and nothing else. Matching only on "•" therefore reads every
       * DOCX bullet as no bullet at all — while the same resume printed to PDF
       * has a real glyph. Both are the same list to the person who wrote it.
       *
       * Guarded so this stays narrow: only under an entry that is already open,
       * only for lines long enough to be a claim, and never for a bare date.
       */
      if (current && !DATE_RANGE.test(line)) {
        const words = line.split(/\s+/).filter(Boolean);
        if (words.length >= 3) current.highlights.push(line);
      }
      continue;
    }

    flush();
    const [, left, right] = pair;
    // "B.S. Computer Science — University of Michigan": the side naming an
    // institution is the organization, whichever order the line uses.
    const rightIsOrganization = /university|college|institute|school|academy|\b(inc|llc|ltd|gmbh|corp|co)\b/i.test(right);
    const leftIsOrganization = !rightIsOrganization
      && /university|college|institute|school|academy|\b(inc|llc|ltd|gmbh|corp|co)\b/i.test(left);
    current = {
      organization: (leftIsOrganization ? left : right).trim(),
      title: (leftIsOrganization ? right : left).trim(),
      ...(dates ? { started: dates[1].trim(), ended: dates[2].trim() } : {}),
      highlights: [],
    };
  }
  flush();
  return entries.slice(0, 40);
}

/**
 * What patterns alone can establish. Runs on every extraction, with or without
 * a model, so a person with no provider configured still gets their contact
 * details, skills and sections filled in rather than an apology.
 */
export function extractByPattern(text: string): ExtractionOutcome {
  const { preamble, sections } = splitSections(text);
  const head = preamble.slice(0, 12).join("\n");
  const draft: Record<string, unknown> = {};

  const email = EMAIL.exec(text)?.[0];
  if (email) draft.email = email;

  const linkedin = LINKEDIN.exec(text)?.[0];
  if (linkedin) draft.linkedinUrl = linkedin.replace(/^http:/, "https:");

  // Only the top of the document: a phone number in a reference or an employer
  // address further down is not the person's own.
  const phone = PHONE.exec(head.replace(EMAIL, ""))?.[0];
  if (phone && phone.replace(/\D/g, "").length >= 7) draft.phone = phone.trim();

  const name = preamble.find(looksLikeName);
  if (name) draft.fullName = name;

  for (const line of preamble.slice(0, 12)) {
    for (const piece of line.split("|")) {
      const match = LOCATION.exec(piece.trim());
      if (match) {
        draft.location = piece.trim();
        break;
      }
    }
    if (draft.location) break;
  }

  const summary = sections.get("summary");
  if (summary && summary.length > 0) draft.summary = summary.join(" ").slice(0, 4000);

  const experience = sections.get("experience");
  if (experience) {
    const history = parseHistory(experience);
    if (history.length > 0) draft.employmentHistory = history;
  }

  const education = sections.get("education");
  if (education) {
    const history = parseHistory(education);
    if (history.length > 0) draft.education = history;
  }

  for (const [key, field] of [
    ["skills", "skills"],
    ["technologies", "technologies"],
    ["certifications", "certifications"],
    ["industries", "industries"],
    ["accomplishments", "accomplishments"],
  ] as const) {
    const lines = sections.get(key);
    if (!lines || lines.length === 0) continue;
    // Accomplishments are sentences, not a comma-separated list.
    const values = field === "accomplishments"
      ? lines.map((line) => line.replace(/^[\s•\-–—*]+/u, "").trim()).filter((line) => line.length > 0)
      : splitList(lines);
    if (values.length > 0) draft[field] = values;
  }

  const parsed = proposalSchema.safeParse(draft);
  const proposal = parsed.success ? parsed.data : dropInvalidFields(draft);
  const sourceMap: Partial<Record<ProposalField, FieldSource>> = {};
  for (const field of Object.keys(proposal) as ProposalField[]) sourceMap[field] = "pattern";
  return { proposal, sources: sourceMap };
}

/**
 * Keep every field that validates and discard only the ones that do not.
 *
 * An all-or-nothing parse would throw away a correct email because a single
 * employment entry was malformed, which is the opposite of "fill in as much as
 * you can". Used for both extractors, so one bad field from a model costs that
 * field and nothing else.
 */
export function dropInvalidFields(draft: Record<string, unknown>): ResumeProposal {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (value === null || value === undefined) continue;
    const single = proposalSchema.safeParse({ [key]: value });
    if (single.success && Object.keys(single.data).length === 1) {
      Object.assign(kept, single.data);
    }
  }
  return proposalSchema.parse(kept);
}

/**
 * The model's answer layered over the pattern pass.
 *
 * The model wins on any field it filled, because it is reading meaning where
 * the pattern pass is matching shapes — but only for fields it actually
 * returned. A field the model omitted keeps whatever the pattern pass found,
 * so adding the model can only ever increase what a person is offered.
 */
export function mergeProposals(
  pattern: ExtractionOutcome,
  model: ResumeProposal,
): ExtractionOutcome {
  const proposal: Record<string, unknown> = { ...pattern.proposal };
  const sources: Partial<Record<ProposalField, FieldSource>> = { ...pattern.sources };

  for (const [key, value] of Object.entries(model)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    proposal[key] = value;
    sources[key as ProposalField] = "model";
  }
  return { proposal: proposalSchema.parse(proposal), sources };
}

/** The instruction the model is given. Extraction only — never invention. */
export const RESUME_SYSTEM_PROMPT = [
  "You extract structured facts from a resume. You never invent, infer, or embellish.",
  "If the resume does not state something, omit that field entirely rather than guessing.",
  "Copy dates, employer names and job titles exactly as written.",
  "Reply with a single JSON object and nothing else — no prose, no code fence.",
].join(" ");

export function resumeExtractionPrompt(text: string): string {
  return [
    "Extract this resume into JSON with these optional keys:",
    "fullName, email, phone, linkedinUrl (must start with https://), location, summary,",
    "employmentHistory and education (arrays of {organization, title, started, ended, summary, highlights[]}),",
    "accomplishments[], skills[], certifications[], technologies[], industries[].",
    "Omit any key the resume does not support. Do not repeat a skill in technologies.",
    "",
    "RESUME:",
    text,
  ].join("\n");
}

/**
 * Parse whatever the model returned.
 *
 * Models wrap JSON in prose or a code fence often enough that refusing those
 * responses would throw away good extractions, so the object is located rather
 * than assumed. Everything after that is strict: unknown keys and invalid
 * fields are dropped, never coerced.
 */
export function parseModelProposal(raw: string): ResumeProposal | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  // Unknown keys are dropped rather than failing the whole object: a model that
  // volunteers "yearsOfExperience" should not cost the person their email.
  const known: Record<string, unknown> = {};
  for (const field of Object.keys(proposalSchema.shape) as ProposalField[]) {
    const value = (parsed as Record<string, unknown>)[field];
    if (value !== undefined) known[field] = value;
  }
  try {
    return dropInvalidFields(known);
  } catch {
    return null;
  }
}

/** How many fields a proposal actually offers — the review screen's headline. */
export function proposedFieldCount(proposal: ResumeProposal): number {
  return Object.values(proposal).filter((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && `${value}`.trim() !== "",
  ).length;
}
