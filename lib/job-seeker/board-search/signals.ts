/**
 * Posting signals: what a posting's own text says about itself (ADR-242).
 *
 * Every signal here is derived from the posting as the board returned it —
 * its title, company, description, salary text, location and work model —
 * and every positive signal names the exact text that produced it. Nothing
 * consults a directory, a model, or a reputation list, and a posting that
 * states nothing derives nothing: "unstated" is a value, never a guess.
 *
 * The complaints these answer are shared by every board: scam postings that
 * look legitimate (the FTC counted $150M of losses in one quarter of 2025),
 * staffing agencies re-listing one job under six names, "estimated" pay
 * shown in the wrong period, remote filters that return on-site roles, and
 * sponsorship that is never stated until the last interview.
 */

export type RedFlagCode =
  | "off_platform_messaging"
  | "upfront_payment"
  | "money_handling"
  | "too_good_pay"
  | "personal_data_early"
  | "free_email_contact"
  | "task_pay";

export type RedFlag = Readonly<{
  code: RedFlagCode;
  /** What the code means, in a sentence a person reads on the card. */
  label: string;
  /** The exact text that matched, so the verdict can be checked. */
  phrase: string;
}>;

const RED_FLAG_PATTERNS: readonly (readonly [RedFlagCode, string, RegExp])[] = [
  [
    "off_platform_messaging",
    "Asks you to continue on a messaging app instead of the platform — the FTC's first warning sign.",
    /\b(?:telegram|whatsapp|signal app|google chat|text (?:me|us) (?:at|on)|sms only|via text message)\b/i,
  ],
  [
    "upfront_payment",
    "Asks you to pay before you are paid (training, equipment, a background check, a starter kit or a fee).",
    /\b(?:pay(?:ment)? (?:for|of) (?:your )?(?:training|equipment|background check|starter kit|materials|registration|application fee|processing fee)|(?:training|equipment|background[- ]check|registration|processing|application) fee(?:s)?(?: (?:is|are))? (?:required|payable|due|of \$?\d+)|(?:training|equipment|background[- ]check|registration|processing|application) fee(?:s)? (?:is|are)|purchase (?:your (?:own )?)?(?:equipment|laptop|software) (?:from|through) (?:our|the) (?:vendor|supplier))\b/i,
  ],
  [
    "money_handling",
    "Involves moving money or goods for someone else (checks, wires, gift cards, crypto, reshipping).",
    /\b(?:cashier'?s check|deposit (?:a|the) check|wire (?:transfer|the funds|money)|gift cards?|bitcoin|cryptocurrency|crypto wallet|reship(?:ping)?|package (?:forwarding|reshipping)|receive (?:and )?forward packages|money (?:transfer|mule)|western union|moneygram)\b/i,
  ],
  [
    "too_good_pay",
    "Promises high pay for no experience or almost no work.",
    /\b(?:no experience (?:needed|necessary|required)[^.]{0,80}\$\s?\d{3,}(?:\s?(?:per|a|\/)\s?(?:day|hour|week))?|\$\s?\d{3,}[^.]{0,40}(?:per|a|\/)\s?(?:day|hour)[^.]{0,60}no experience|earn (?:up to )?\$\s?\d{3,}[^.]{0,20}(?:per|a) (?:day|week) from home|get rich|guaranteed income|unlimited earning)\b/i,
  ],
  [
    "personal_data_early",
    "Asks for bank details, a social security number or an ID scan before any interview.",
    /\b(?:social security number|ssn|bank (?:account )?(?:details|information|number)|routing number|copy of your (?:passport|driver'?s licen[cs]e|id))\b[^.]{0,80}\b(?:before|prior to|to apply|with your application|to be considered)\b/i,
  ],
  [
    "free_email_contact",
    "Wants applications sent to a personal webmail address rather than the company's.",
    /\b(?:send|email|forward|submit)\b.{0,60}?\b(?:resume|cv|application|details)\b.{0,60}?[\w.+-]+@(?:gmail|yahoo|hotmail|outlook|aol|icloud|proton(?:mail)?)\.com\b/i,
  ],
  [
    "task_pay",
    "Pays per like, review, click or task — the shape of a task scam.",
    /\b(?:paid (?:per|for each) (?:like|review|click|task|video watched)|like (?:videos|posts) (?:and|to) (?:earn|get paid)|rate products (?:and|to) (?:earn|get paid)|complete (?:simple|easy) (?:online )?tasks (?:and|to) (?:earn|get paid)|per task completed)\b/i,
  ],
];

/** The red flags a posting's text raises, each with the matched phrase. */
export function scanRedFlags(text: string): RedFlag[] {
  const flags: RedFlag[] = [];
  const folded = text.replace(/\s+/g, " ");
  for (const [code, label, pattern] of RED_FLAG_PATTERNS) {
    const match = pattern.exec(folded);
    if (match !== null) {
      flags.push({ code, label, phrase: match[0].trim().slice(0, 120) });
    }
  }
  return flags;
}

const AGENCY_PATTERN =
  /\b(?:staffing|recruit(?:ing|ment|ers?)|talent (?:partners?|solutions?|group|acquisition)|personnel|headhunt(?:ers?|ing)|placements?|manpower|workforce solutions?|temp(?:orary)? (?:services?|agency)|employment (?:agency|services?)|search (?:partners?|group|firm))\b/i;

export type AgencyLikely = Readonly<{ likely: boolean; phrase: string | null }>;

/**
 * Whether the company name reads as a staffing or recruiting agency — from
 * the name alone, labeled as such. An agency is not a scam and is not hidden
 * by default; the label lets a person exclude the one job listed under six
 * agency names, which is the complaint.
 */
export function deriveAgencyLikely(company: string): AgencyLikely {
  const match = AGENCY_PATTERN.exec(company);
  return match === null ? { likely: false, phrase: null } : { likely: true, phrase: match[0] };
}

export const SPONSORSHIP_STATES = ["stated_yes", "stated_no"] as const;
export type Sponsorship = (typeof SPONSORSHIP_STATES)[number];

const SPONSORSHIP_NO =
  /\b(?:(?:no|not|unable to|cannot|can't|will not|won't|does not|doesn't|not able to|not offering|not providing) (?:offer |provide |be able to |currently )?(?:visa )?sponsor(?:ship)?(?: (?:visas?|h-?1b|work permits?))?|without (?:the need for |requiring )?(?:visa )?sponsorship|sponsorship (?:is )?not (?:available|offered|provided)|must be (?:legally )?authori[sz]ed to work[^.]{0,60}without sponsorship)\b/i;
const SPONSORSHIP_YES =
  /\b(?:(?:visa|h-?1b|work permit|immigration) sponsorship (?:is )?(?:available|offered|provided|possible)|(?:we|company|employer) (?:will|can|do|does) (?:offer |provide )?(?:visa )?sponsor(?:ship)?|sponsorship (?:available|offered|provided)|open to sponsoring|willing to sponsor)\b/i;

export type SponsorshipVerdict = Readonly<{ state: Sponsorship | null; phrase: string | null }>;

/**
 * Whether the posting states that it sponsors a visa, states that it does
 * not, or says nothing. The "no" patterns run first because they contain
 * the word sponsorship too; a posting that says both derives "no", since
 * an exception buried in a sentence is what a person needs warned about.
 */
export function deriveSponsorship(text: string): SponsorshipVerdict {
  const folded = text.replace(/\s+/g, " ");
  const no = SPONSORSHIP_NO.exec(folded);
  if (no !== null) return { state: "stated_no", phrase: no[0] };
  const yes = SPONSORSHIP_YES.exec(folded);
  if (yes !== null) return { state: "stated_yes", phrase: yes[0] };
  return { state: null, phrase: null };
}

export type WorkModel = "remote" | "hybrid" | "onsite";

export type WorkModelVerdict = Readonly<{
  model: WorkModel | null;
  /** True when the model came from the posting text, not the board's field. */
  derived: boolean;
  phrase: string | null;
}>;

const WORK_MODEL_PATTERNS: readonly (readonly [WorkModel, RegExp])[] = [
  ["hybrid", /\bhybrid\b/i],
  ["remote", /\b(?:fully remote|remote[- ]first|100% remote|work from home|work-from-home|wfh|remote (?:position|role|job|work)|(?:position|role|job) is remote|remote:?\s?(?:yes|ok|friendly))\b/i],
  ["onsite", /\b(?:on-?site|in[- ]office|in person|in-person|at our office|office[- ]based)\b/i],
];

/**
 * The work model: the board's own field when it states one, otherwise the
 * posting text, labeled derived. Hybrid is read first because a hybrid
 * posting mentions both the office and remote days; a posting that says
 * nothing derives nothing.
 */
export function deriveWorkModel(stated: WorkModel | null, text: string): WorkModelVerdict {
  if (stated !== null) return { model: stated, derived: false, phrase: null };
  const folded = text.replace(/\s+/g, " ");
  for (const [model, pattern] of WORK_MODEL_PATTERNS) {
    const match = pattern.exec(folded);
    if (match !== null) return { model, derived: true, phrase: match[0] };
  }
  return { model: null, derived: false, phrase: null };
}

export type SalaryPeriod = "hour" | "day" | "week" | "month" | "year";

export type ParsedSalary = Readonly<{
  low: number;
  high: number;
  period: SalaryPeriod | null;
  currency: string | null;
  /** The annual equivalent of `high`, when a period is stated; the assumption is printed. */
  annualized: number | null;
  /** The whole arithmetic in one sentence. */
  note: string;
}>;

const PERIOD_PATTERNS: readonly (readonly [SalaryPeriod, RegExp])[] = [
  ["hour", /\b(?:per hour|an hour|\/\s?(?:hr|hour)|hourly|p\.?h\.?)\b|\/h\b/i],
  ["day", /\b(?:per day|a day|\/\s?day|daily|per diem)\b/i],
  ["week", /\b(?:per week|a week|\/\s?(?:wk|week)|weekly)\b/i],
  ["month", /\b(?:per month|a month|\/\s?(?:mo|month)|monthly|pm)\b/i],
  ["year", /\b(?:per year|a year|per annum|\/\s?(?:yr|year|annum)|annual(?:ly)?|p\.?a\.?)\b/i],
];

const HOURS_PER_YEAR = 2080;
const DAYS_PER_YEAR = 260;

/**
 * Numbers, period and currency as the posting wrote them, and the annual
 * equivalent with its assumption stated. A figure with no period is left
 * as written — Indeed's complaint was a seasonal stipend shown as monthly,
 * and the cure is to print the period the board gave, not to invent one.
 */
export function parseSalary(salaryText: string | null): ParsedSalary | null {
  if (salaryText === null) return null;
  const figures = [...salaryText.matchAll(/(\d[\d,.]*)\s*(k)?/gi)]
    .map((match) => {
      const raw = Number(match[1]!.replace(/[,.](?=\d{3}\b)/g, "").replace(/,/g, "."));
      if (!Number.isFinite(raw)) return null;
      return match[2] ? raw * 1000 : raw;
    })
    .filter((value): value is number => value !== null && value > 0);
  if (figures.length === 0) return null;
  const low = Math.min(...figures);
  const high = Math.max(...figures);
  let period: SalaryPeriod | null = null;
  for (const [candidate, pattern] of PERIOD_PATTERNS) {
    if (pattern.test(salaryText)) {
      period = candidate;
      break;
    }
  }
  // A large figure with no stated period is read as annual only when it
  // could not be anything else: nobody is paid 60,000 an hour.
  if (period === null && low >= 10_000) period = "year";
  const currencyMatch = /\b(USD|EUR|GBP|DKK|SEK|NOK|CHF|CAD|AUD|INR|JPY)\b|([$€£])/i.exec(salaryText);
  const currency = currencyMatch === null
    ? null
    : (currencyMatch[1]?.toUpperCase() ?? { $: "USD", "€": "EUR", "£": "GBP" }[currencyMatch[2]!] ?? null);
  const multiplier = period === "hour"
    ? HOURS_PER_YEAR
    : period === "day"
      ? DAYS_PER_YEAR
      : period === "week"
        ? 52
        : period === "month"
          ? 12
          : period === "year"
            ? 1
            : null;
  const annualized = multiplier === null ? null : Math.round(high * multiplier);
  const range = low === high ? fmt(high) : `${fmt(low)}–${fmt(high)}`;
  const note = period === null
    ? `${range} with no pay period stated — shown as written.`
    : period === "year"
      ? `${range} per year as written.`
      : `${range} per ${period} → about ${fmt(annualized!)} per year, assuming ${
        period === "hour" ? `${HOURS_PER_YEAR} hours` : period === "day" ? `${DAYS_PER_YEAR} days` : period === "week" ? "52 weeks" : "12 months"
      } a year.`;
  return { low, high, period, currency, annualized, note };
}

function fmt(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export type CompletenessField = "pay" | "place" | "work_model" | "level" | "description" | "posted";

export type Completeness = Readonly<{
  present: readonly CompletenessField[];
  missing: readonly CompletenessField[];
  /** present.length of 6. */
  score: number;
}>;

export const COMPLETENESS_FIELDS: readonly CompletenessField[] = [
  "pay", "place", "work_model", "level", "description", "posted",
];

/**
 * What the posting bothered to state, out of the six facts a person needs
 * before applying. A short description counts as missing: under 200
 * characters there is nothing to assess skills against.
 */
export function postingCompleteness(args: Readonly<{
  salaryText: string | null;
  location: string | null;
  workModel: WorkModel | null;
  titleStatesLevel: boolean;
  description: string | null;
  publishedOn: string | null;
}>): Completeness {
  const has: Record<CompletenessField, boolean> = {
    pay: args.salaryText !== null && parseSalary(args.salaryText) !== null,
    place: args.location !== null && args.location.trim().length > 0,
    work_model: args.workModel !== null,
    level: args.titleStatesLevel,
    description: (args.description ?? "").trim().length >= 200,
    posted: args.publishedOn !== null,
  };
  const present = COMPLETENESS_FIELDS.filter((field) => has[field]);
  const missing = COMPLETENESS_FIELDS.filter((field) => !has[field]);
  return { present, missing, score: present.length };
}

export const COMPLETENESS_LABELS: Readonly<Record<CompletenessField, string>> = {
  pay: "pay",
  place: "place",
  work_model: "work model",
  level: "level",
  description: "a real description",
  posted: "a posting date",
};

/** Everything the card shows about a posting's own text, in one object. */
export type PostingSignals = Readonly<{
  redFlags: readonly RedFlag[];
  agency: AgencyLikely;
  sponsorship: SponsorshipVerdict;
  workModel: WorkModelVerdict;
  salary: ParsedSalary | null;
  completeness: Completeness;
}>;

export function postingSignals(args: Readonly<{
  title: string;
  company: string;
  description: string | null;
  salaryText: string | null;
  location: string | null;
  workModel: WorkModel | null;
  publishedOn: string | null;
  titleStatesLevel: boolean;
}>): PostingSignals {
  const text = [args.title, args.description ?? ""].join(" ");
  const workModel = deriveWorkModel(args.workModel, text);
  return {
    redFlags: scanRedFlags(text),
    agency: deriveAgencyLikely(args.company),
    sponsorship: deriveSponsorship(text),
    workModel,
    salary: parseSalary(args.salaryText),
    completeness: postingCompleteness({
      salaryText: args.salaryText,
      location: args.location,
      workModel: workModel.model,
      titleStatesLevel: args.titleStatesLevel,
      description: args.description,
      publishedOn: args.publishedOn,
    }),
  };
}
