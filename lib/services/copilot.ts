/**
 * The Services copilot — deterministic answers from the workspace's own rows.
 *
 * Every answer here is COMPUTED, never generated: the route runs bounded
 * RLS-scoped reads and these functions turn the resulting figures into
 * sentences. That is the honest boundary for this phase — a model that
 * drafts free-form prose is an outbound AI capability, and outbound AI
 * execution is Not Connected until an owner supplies a provider. When that
 * happens it will be a new gated capability beside this one, not a quiet
 * upgrade to it; these answers must stay reproducible from the database
 * alone.
 */

export const COPILOT_SKILLS = [
  {
    id: "overdue_invoices",
    label: "Overdue invoices",
    example: "Which invoices are overdue?",
    keywords: ["overdue", "past due", "late invoice", "unpaid", "receivable", "owe", "owes", "collection"],
  },
  {
    id: "todays_routes",
    label: "Today's routes",
    example: "Who is driving what today?",
    keywords: ["route", "driving", "stops", "dispatch today", "today's schedule"],
  },
  {
    id: "upcoming_visits",
    label: "This week's visits",
    example: "What visits are coming up this week?",
    keywords: ["upcoming", "this week", "next 7", "coming up", "visits", "appointments", "scheduled"],
  },
  {
    id: "autopay_coverage",
    label: "Autopay coverage",
    example: "How many accounts are on autopay?",
    keywords: ["autopay", "auto pay", "auto-pay", "automatic payment", "card on file"],
  },
  {
    id: "monthly_revenue",
    label: "This month's billing",
    example: "How much have we invoiced this month?",
    keywords: ["revenue", "invoiced this month", "billed", "billing total", "how much", "month so far"],
  },
] as const;

export type CopilotSkillId = (typeof COPILOT_SKILLS)[number]["id"];

/**
 * Keyword match, most-specific wins. Deliberately not fuzzy: a wrong
 * answer delivered confidently is worse than "I don't know that one",
 * and every miss lists what CAN be asked.
 */
export function matchQuestion(question: string): CopilotSkillId | null {
  const q = question.toLowerCase();
  let best: { id: CopilotSkillId; score: number } | null = null;
  for (const skill of COPILOT_SKILLS) {
    const score = skill.keywords.filter((keyword) => q.includes(keyword)).length;
    if (score > 0 && (best === null || score > best.score)) {
      best = { id: skill.id, score };
    }
  }
  return best?.id ?? null;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function composeOverdueAnswer(facts: {
  count: number;
  totalOutstandingCents: number;
  oldestDueOn: string | null;
}): string {
  if (facts.count === 0) {
    return "Nothing is overdue. Every open invoice is inside its due date.";
  }
  const plural = facts.count === 1 ? "invoice is" : "invoices are";
  const oldest = facts.oldestDueOn ? ` The oldest has been due since ${facts.oldestDueOn}.` : "";
  return `${facts.count} ${plural} past due, ${dollars(facts.totalOutstandingCents)} outstanding in total.${oldest}`;
}

export function composeRoutesAnswer(facts: {
  routes: ReadonlyArray<{ technician: string; stops: number; status: string }>;
  day: string;
}): string {
  if (facts.routes.length === 0) {
    return `No routes are planned for ${facts.day}. The day route board is empty.`;
  }
  const lines = facts.routes
    .map((route) => `${route.technician} has ${route.stops} stop${route.stops === 1 ? "" : "s"} (${route.status})`)
    .join("; ");
  return `${facts.routes.length} route${facts.routes.length === 1 ? "" : "s"} for ${facts.day}: ${lines}.`;
}

export function composeVisitsAnswer(facts: { count: number; firstStart: string | null }): string {
  if (facts.count === 0) {
    return "No visits are scheduled in the next seven days.";
  }
  const first = facts.firstStart ? ` The first is ${facts.firstStart}.` : "";
  return `${facts.count} visit${facts.count === 1 ? " is" : "s are"} scheduled over the next seven days.${first}`;
}

export function composeAutopayAnswer(facts: { enrolled: number; accounts: number }): string {
  if (facts.accounts === 0) {
    return "There are no customer accounts yet, so autopay coverage is not meaningful.";
  }
  const percent = Math.round((facts.enrolled / facts.accounts) * 100);
  return `${facts.enrolled} of ${facts.accounts} accounts (${percent}%) have an active autopay enrollment.`;
}

export function composeRevenueAnswer(facts: {
  month: string;
  invoiced: number;
  totalCents: number;
  collectedCents: number;
}): string {
  if (facts.invoiced === 0) {
    return `No invoices have been raised in ${facts.month} yet.`;
  }
  return (
    `${facts.invoiced} invoice${facts.invoiced === 1 ? "" : "s"} raised in ${facts.month} `
    + `for ${dollars(facts.totalCents)}; ${dollars(facts.collectedCents)} of that is already collected.`
  );
}

/** The refusal that teaches: what this copilot can actually answer. */
export function composeUnknownAnswer(): string {
  const examples = COPILOT_SKILLS.map((skill) => `"${skill.example}"`).join(", ");
  return (
    "I can only answer questions I can compute from your own records, and I did not "
    + `recognize that one. Try: ${examples}. Free-form drafting needs an AI provider, `
    + "which is Not Connected."
  );
}
