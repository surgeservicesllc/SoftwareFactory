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
  {
    id: "followups",
    label: "What to do next",
    example: "What should I follow up on today?",
    keywords: ["follow up", "follow-up", "followup", "to do", "todo", "my plate", "next step", "what should i"],
  },
  {
    id: "hot_leads",
    label: "Warmest leads",
    example: "Which leads are the warmest right now?",
    keywords: ["warmest", "hottest", "hot lead", "warm lead", "best lead", "lead score", "top lead"],
  },
  {
    id: "churn_risk",
    label: "Churn risk",
    example: "Which customers are at risk of leaving?",
    keywords: ["churn", "at risk", "risk of leaving", "might cancel", "losing", "leaving"],
  },
  {
    id: "upsell",
    label: "Room to grow",
    example: "Where is there room to sell more?",
    keywords: ["upsell", "sell more", "cross-sell", "cross sell", "room to grow", "expand", "grow the account"],
  },
  {
    id: "lost_money",
    label: "Visits that lost money",
    example: "Which jobs lost money this quarter?",
    keywords: ["lost money", "losing money", "unprofitable", "negative margin", "profitab", "margin", "cost us"],
  },
  {
    id: "schedule_audit",
    label: "What contradicts in the schedule",
    example: "What contradicts in the schedule?",
    keywords: ["wrong with", "double book", "double-book", "overlap", "unrouted", "schedule audit", "contradict", "conflict"],
  },
  {
    id: "customer_ratings",
    label: "How customers rate us",
    example: "How are customers rating us?",
    keywords: ["rating", "rated", "survey", "satisfaction", "nps", "how are customers", "feedback"],
  },
  {
    id: "help_desk",
    label: "What is late on the help desk",
    example: "Which requests are past their promise?",
    keywords: ["past their promise", "past promise", "sla", "help desk", "unanswered request", "late request", "requests are late", "waiting on us"],
  },
  {
    id: "unassigned_requests",
    label: "Requests nobody has",
    example: "Which requests have nobody assigned?",
    keywords: ["nobody assigned", "unassigned", "nobody has", "who should take", "who has the request", "assign the request", "route the request", "queue by person"],
  },
  {
    id: "knowledge",
    label: "What the knowledge base says",
    example: "What do we tell customers about ants?",
    keywords: ["what do we tell", "knowledge base", "help article", "article about", "how do we explain", "what do we say", "what does the article", "written about"],
  },
  {
    id: "stale_contacts",
    label: "Contacts the book should not trust",
    example: "Which contacts are stale?",
    keywords: ["stale", "bounced", "undeliverable", "duplicate contact", "duplicate email", "hygiene", "clean up contacts", "bad contacts"],
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
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export function composeFollowupsAnswer(facts: {
  overdue: number;
  dueToday: number;
  suggestions: ReadonlyArray<{ title: string; reason: string }>;
  suggestionCount: number;
}): string {
  const owed =
    facts.overdue === 0 && facts.dueToday === 0
      ? "No open follow-ups are due today or overdue."
      : `${facts.overdue} overdue and ${facts.dueToday} due today among your open follow-ups.`;
  if (facts.suggestionCount === 0) {
    return `${owed} Your records suggest nothing further right now.`;
  }
  const top = facts.suggestions
    .slice(0, 3)
    .map((suggestion) => `${suggestion.title} (${suggestion.reason})`)
    .join("; ");
  const more = facts.suggestionCount > 3 ? ` and ${facts.suggestionCount - 3} more on the Follow-ups page` : "";
  return `${owed} Your records suggest: ${top}${more}.`;
}

export function composeSignalsAnswer(facts: {
  model: "lead" | "churn" | "upsell";
  scored: number;
  top: ReadonlyArray<{ name: string; score: number; facts: ReadonlyArray<string> }>;
}): string {
  const noun = facts.model === "lead" ? "lead or prospect" : "customer";
  if (facts.scored === 0) {
    return `There is no ${noun} to score yet.`;
  }
  const lead = {
    lead: "The warmest leads",
    churn: "The customers most at risk",
    upsell: "The customers with the most room to grow",
  }[facts.model];
  if (facts.top.length === 0) {
    return `${lead}: none — no rule applies to any of the ${facts.scored} scored right now.`;
  }
  const lines = facts.top
    .map((entry) => `${entry.name} at ${entry.score} (${entry.facts.slice(0, 3).join("; ") || "no rule applies"})`)
    .join("; ");
  return `${lead}, scored from your own records: ${lines}. Every point is itemised on the Signals page.`;
}

export function composeLostMoneyAnswer(facts: {
  days: number;
  completed: number;
  known: number;
  losers: ReadonlyArray<{ account: string; service: string; marginCents: number; revenueCents: number }>;
}): string {
  if (facts.completed === 0) {
    return `No visits were completed in the last ${facts.days} days, so there is nothing to cost.`;
  }
  const unknown = facts.completed - facts.known;
  const coverage = unknown === 0
    ? `All ${facts.completed} completed visits have every cost input on file.`
    : `${facts.known} of ${facts.completed} completed visits have every cost input on file; ${unknown} cannot be costed yet (no invoice, no hourly cost, or an uncosted lot).`;
  if (facts.losers.length === 0) {
    return `${coverage} None of the costed visits lost money in the last ${facts.days} days.`;
  }
  const lines = facts.losers
    .slice(0, 3)
    .map((visit) => `${visit.account} (${visit.service}: ${dollars(visit.marginCents)} on ${dollars(visit.revenueCents)} revenue)`)
    .join("; ");
  return `${coverage} ${facts.losers.length} lost money in the last ${facts.days} days; the worst: ${lines}. Every input is printed on the Profitability page.`;
}

export function composeScheduleAuditAnswer(facts: {
  days: number;
  total: number;
  bySeverity: { high: number; medium: number; low: number };
  byFinding: ReadonlyArray<{ label: string; count: number }>;
  worst: ReadonlyArray<{ label: string; account: string; detail: string }>;
}): string {
  if (facts.total === 0) {
    return `Nothing contradicts in the next ${facts.days} days: no double bookings, no unrouted visits, no due plan without a visit, no arrival outside its window, and nothing left open past its window.`;
  }
  const kinds = facts.byFinding.map((entry) => `${entry.count} ${entry.label.toLowerCase()}`).join(", ");
  const urgent = facts.bySeverity.high > 0 ? ` ${facts.bySeverity.high} need${facts.bySeverity.high === 1 ? "s" : ""} attention today.` : "";
  const worst = facts.worst
    .slice(0, 3)
    .map((finding) => `${finding.account} — ${finding.label.toLowerCase()}: ${finding.detail}`)
    .join("; ");
  return `${facts.total} contradiction${facts.total === 1 ? "" : "s"} in the next ${facts.days} days (${kinds}).${urgent} First: ${worst}. Every one is listed on the Schedule page with the rows involved.`;
}

export function composeRatingsAnswer(facts: {
  days: number;
  responses: number;
  completedVisits: number;
  averageScore: number | null;
  responseRateBps: number | null;
  detractors: ReadonlyArray<{ account: string; score: number; comment: string | null }>;
}): string {
  if (facts.responses === 0) {
    return facts.completedVisits === 0
      ? `No visits were completed in the last ${facts.days} days, so nobody was asked.`
      : `${facts.completedVisits} visits were completed in the last ${facts.days} days and none has been rated yet — customers are asked in the portal after each completed visit.`;
  }
  const rate = facts.responseRateBps === null ? "" : ` (${(facts.responseRateBps / 100).toFixed(0)}% of ${facts.completedVisits} completed visits)`;
  const average = facts.averageScore === null ? "no average" : `${facts.averageScore.toFixed(2)} out of 5`;
  const worst = facts.detractors.length === 0
    ? "Nobody rated a visit 1 or 2."
    : `${facts.detractors.length} rated a visit 1 or 2 — call back ${facts.detractors
        .slice(0, 3)
        .map((entry) => `${entry.account} (${entry.score}/5${entry.comment ? `: "${entry.comment}"` : ""})`)
        .join("; ")}.`;
  return `${facts.responses} rating${facts.responses === 1 ? "" : "s"} in the last ${facts.days} days${rate}, averaging ${average}. ${worst} Every response is on the Customer Portal page under Ratings.`;
}

export function composeHelpDeskAnswer(facts: {
  open: number;
  overdue: number;
  late: ReadonlyArray<{ account: string; kind: string; summary: string; waitingMinutes: number | null; promise: string }>;
}): string {
  if (facts.open === 0) return "Nothing is open on the help desk.";
  if (facts.overdue === 0) {
    return `${facts.open} request${facts.open === 1 ? " is" : "s are"} open and every one is inside its promise.`;
  }
  const lines = facts.late
    .slice(0, 3)
    .map((entry) => {
      const waited = entry.waitingMinutes === null
        ? ""
        : entry.waitingMinutes < 120
          ? ` after ${entry.waitingMinutes} min`
          : ` after ${(entry.waitingMinutes / 60).toFixed(1)} h`;
      return `${entry.account} — ${entry.kind}: "${entry.summary}" (${entry.promise} overdue${waited})`;
    })
    .join("; ");
  return `${facts.overdue} of ${facts.open} open requests ${facts.overdue === 1 ? "is" : "are"} past a promise. First: ${lines}. The full clock is on the Customer Portal page.`;
}

export function composeHygieneAnswer(facts: {
  contacts: number;
  byFlag: ReadonlyArray<{ label: string; count: number }>;
  worst: ReadonlyArray<{ contact: string; account: string; labels: ReadonlyArray<string> }>;
}): string {
  if (facts.contacts === 0) {
    return "Every contact on the book can be reached, is unique, sits on a live account, and has been touched this year.";
  }
  const reasons = facts.byFlag.map((entry) => `${entry.count} ${entry.label.toLowerCase()}`).join(", ");
  const worst = facts.worst
    .slice(0, 3)
    .map((entry) => `${entry.contact} at ${entry.account} (${entry.labels.map((label) => label.toLowerCase()).join("; ")})`)
    .join("; ");
  return `${facts.contacts} contact${facts.contacts === 1 ? "" : "s"} should not be trusted as ${facts.contacts === 1 ? "it stands" : "they stand"}: ${reasons}. Start with ${worst}. Nothing is deleted for you — the list is on the Data page under Hygiene, and each row opens its account.`;
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
