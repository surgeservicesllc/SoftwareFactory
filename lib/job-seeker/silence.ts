/**
 * Silence measured (ADR-243): how long an application has gone unanswered,
 * against the person's own recorded reply times, and a follow-up date
 * derived from them with the arithmetic printed.
 *
 * Nothing here estimates an employer's behaviour. The median comes from the
 * person's own applications through `job_seeker_response_stats`; with no
 * recorded replies the default wait is stated as a default, and the
 * suggestion is held between seven and twenty-one days so one freak reply
 * cannot make it absurd. Every sentence names the numbers it used.
 */

export type ReplyStats = Readonly<{
  /** null means every source together. */
  source: string | null;
  applied: number;
  replied: number;
  silent: number;
  medianDaysToReply: number | null;
}>;

export type SilenceView = Readonly<{
  daysSinceApplied: number;
  /** Days without a reply; null once a reply is recorded or the application is closed. */
  daysSilent: number | null;
  repliedAfterDays: number | null;
  sentence: string;
  /** ISO date of the suggested follow-up, when one applies. */
  suggestedFollowUpOn: string | null;
  suggestionSentence: string | null;
}>;

export const DEFAULT_WAIT_DAYS = 7;
export const MIN_WAIT_DAYS = 7;
export const MAX_WAIT_DAYS = 21;

const RESPONSE_STAGES = new Set(["RECRUITER_RESPONSE", "INTERVIEW", "FINAL_INTERVIEW", "OFFER"]);

function days(from: string, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - Date.parse(from)) / 86_400_000));
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Ledger rows as PostgREST returns them, mapped to the view's shape. */
export function toReplyStats(row: Record<string, unknown>): ReplyStats {
  return {
    source: (row.source as string | null) ?? null,
    applied: Number(row.applied ?? 0),
    replied: Number(row.replied ?? 0),
    silent: Number(row.silent ?? 0),
    medianDaysToReply: row.median_days_to_reply == null ? null : Number(row.median_days_to_reply),
  };
}

export function describeSilence(args: Readonly<{
  appliedAt: string | null;
  repliedAt: string | null;
  stage: string;
  source: string;
  stats: readonly ReplyStats[];
  now?: Date;
}>): SilenceView | null {
  if (args.appliedAt === null || !Number.isFinite(Date.parse(args.appliedAt))) return null;
  const now = args.now ?? new Date();
  const daysSinceApplied = days(args.appliedAt, now);

  if (args.repliedAt !== null && Number.isFinite(Date.parse(args.repliedAt))) {
    const after = days(args.appliedAt, new Date(args.repliedAt));
    return Object.freeze({
      daysSinceApplied,
      daysSilent: null,
      repliedAfterDays: after,
      sentence: `Replied after ${plural(after, "day", "days")}.`,
      suggestedFollowUpOn: null,
      suggestionSentence: null,
    });
  }
  if (RESPONSE_STAGES.has(args.stage)) {
    // The stage says a reply happened but the ledger has no row for it —
    // the application predates the ledger. Say that, invent no date.
    return Object.freeze({
      daysSinceApplied,
      daysSilent: null,
      repliedAfterDays: null,
      sentence: "A reply is recorded by the stage, but its date predates the transitions ledger.",
      suggestedFollowUpOn: null,
      suggestionSentence: null,
    });
  }
  if (args.stage === "CLOSED") {
    return Object.freeze({
      daysSinceApplied,
      daysSilent: null,
      repliedAfterDays: null,
      sentence: `Closed after ${plural(daysSinceApplied, "day", "days")} with no reply recorded.`,
      suggestedFollowUpOn: null,
      suggestionSentence: null,
    });
  }

  // Compare against this source's own replies first, then everything.
  const bySource = args.stats.find((row) => row.source === args.source && row.replied > 0) ?? null;
  const overall = args.stats.find((row) => row.source === null && row.replied > 0) ?? null;
  const baseline = bySource ?? overall;
  const scope = bySource !== null ? `on ${args.source}` : "across all sources";

  const comparison = baseline === null || baseline.medianDaysToReply === null
    ? "You have no recorded replies yet to compare against."
    : `Your median reply took ${baseline.medianDaysToReply} days across ${plural(baseline.replied, "reply", "replies")} ${scope}.`;

  const median = baseline?.medianDaysToReply ?? null;
  const waitDays = Math.min(MAX_WAIT_DAYS, Math.max(MIN_WAIT_DAYS, Math.round(median ?? DEFAULT_WAIT_DAYS)));
  const suggested = new Date(Date.parse(args.appliedAt) + waitDays * 86_400_000);
  const suggestedOn = suggested.toISOString().slice(0, 10);
  const appliedOn = args.appliedAt.slice(0, 10);
  const basis = median === null
    ? `the default ${DEFAULT_WAIT_DAYS} days while no reply is recorded`
    : `your median ${median} ${scope}, held between ${MIN_WAIT_DAYS} and ${MAX_WAIT_DAYS}`;
  const overdue = suggested.getTime() < now.getTime() - 86_400_000;

  return Object.freeze({
    daysSinceApplied,
    daysSilent: daysSinceApplied,
    repliedAfterDays: null,
    sentence: `Silent for ${plural(daysSinceApplied, "day", "days")}. ${comparison}`,
    suggestedFollowUpOn: suggestedOn,
    suggestionSentence: overdue
      ? `A follow-up was due ${suggestedOn}: applied ${appliedOn} + ${waitDays} days (${basis}).`
      : `Follow up on ${suggestedOn}: applied ${appliedOn} + ${waitDays} days (${basis}).`,
  });
}

export const CLOSED_REASONS = [
  "no_response",
  "rejected_before_interview",
  "rejected_after_interview",
  "withdrew",
  "offer_declined",
  "position_filled",
  "other",
] as const;

export type ClosedReason = (typeof CLOSED_REASONS)[number];

export const CLOSED_REASON_LABELS: Readonly<Record<ClosedReason, string>> = {
  no_response: "No response",
  rejected_before_interview: "Rejected before an interview",
  rejected_after_interview: "Rejected after an interview",
  withdrew: "I withdrew",
  offer_declined: "I declined the offer",
  position_filled: "Position filled or cancelled",
  other: "Other",
};

/** The stages in pipeline order; the funnel counts applications that ever reached each. */
export const FUNNEL_STAGES = [
  "FOUND", "QUALIFIED", "RESUME_CREATED", "READY_FOR_REVIEW", "APPLIED",
  "FOLLOW_UP", "RECRUITER_RESPONSE", "INTERVIEW", "FINAL_INTERVIEW", "OFFER", "CLOSED",
] as const;

/**
 * How many applications ever reached each stage, from the transitions each
 * application recorded. "Reached" counts the application once per stage
 * however many times it passed through, so the funnel is monotone in the
 * sense that matters: a stage's count is applications, not events.
 */
export function buildFunnel(
  transitions: ReadonlyArray<{ applicationId: string; toStage: string }>,
): Array<{ stage: string; reached: number }> {
  const reached = new Map<string, Set<string>>();
  for (const transition of transitions) {
    const set = reached.get(transition.toStage) ?? new Set<string>();
    set.add(transition.applicationId);
    reached.set(transition.toStage, set);
  }
  return FUNNEL_STAGES.map((stage) => ({ stage, reached: reached.get(stage)?.size ?? 0 }));
}
