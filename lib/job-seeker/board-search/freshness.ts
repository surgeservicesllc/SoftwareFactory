/**
 * Freshness: how long a posting has really been up, said in numbers (ADR-241).
 *
 * The complaint every board shares is the ghost job — a role posted months
 * ago, reposted so it looks new, or left up after it closed. Boards show a
 * posting date at best. This product also keeps a sightings ledger: the
 * first and last time it returned the URL, how many searches it appeared
 * in, and whether the board's own posting date moved forward (a repost).
 * The verdict below is arithmetic over those facts, and every sentence in
 * `reasons` names the number it came from, so a person can disagree with
 * the threshold while trusting the count.
 *
 * Thresholds are this product's, chosen and printed, not borrowed from a
 * study: under 21 days is fresh, 21 to 44 is aging, 45 and over is likely
 * stale. A closing date that has passed, or two or more re-datings, is
 * likely stale regardless of age. A posting with no date the board stated
 * and no earlier sighting is unknown — never assumed fresh.
 */

export const FRESH_UNDER_DAYS = 21;
export const STALE_FROM_DAYS = 45;
export const REPOSTS_FOR_STALE = 2;

export type FreshnessLevel = "fresh" | "aging" | "stale" | "unknown";

export type Sighting = Readonly<{
  firstSeenAt: string;
  lastSeenAt: string;
  timesSeen: number;
  earliestPostedOn: string | null;
  latestPostedOn: string | null;
  reposts: number;
  closesOn: string | null;
}>;

export type Freshness = Readonly<{
  level: FreshnessLevel;
  /** Days since the board's stated posting date, when it stated one. */
  postedDaysAgo: number | null;
  /** Days since this product first returned the URL, when it has before. */
  firstSeenDaysAgo: number | null;
  timesSeen: number;
  reposts: number;
  /** Each sentence names the number that produced the verdict. */
  reasons: readonly string[];
}>;

function daysBetween(earlier: string, later: Date): number | null {
  const at = Date.parse(earlier);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((later.getTime() - at) / 86_400_000));
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function assessFreshness(args: Readonly<{
  publishedOn: string | null;
  closesOn: string | null;
  sighting: Sighting | null;
  now?: Date;
}>): Freshness {
  const now = args.now ?? new Date();
  const reasons: string[] = [];

  // The board's posting date: the earliest one ever stated for this URL
  // beats what it says today, because a re-dated posting is older than it
  // claims — that is the whole point of counting reposts.
  const statedPostedOn = args.sighting?.earliestPostedOn ?? args.publishedOn;
  const postedDaysAgo = statedPostedOn === null ? null : daysBetween(statedPostedOn, now);
  const firstSeenDaysAgo = args.sighting === null ? null : daysBetween(args.sighting.firstSeenAt, now);
  const timesSeen = args.sighting?.timesSeen ?? 0;
  const reposts = args.sighting?.reposts ?? 0;
  const closesOn = args.closesOn ?? args.sighting?.closesOn ?? null;
  const closedDaysAgo = closesOn === null ? null : daysBetween(closesOn, now);
  const closingPassed = closedDaysAgo !== null && Date.parse(closesOn!) < now.getTime() - 86_400_000;

  if (postedDaysAgo !== null) {
    reasons.push(
      args.sighting?.earliestPostedOn !== null && args.sighting?.earliestPostedOn !== undefined
        && args.publishedOn !== null && args.sighting.earliestPostedOn < args.publishedOn
        ? `The board now dates it ${args.publishedOn}, but it was first dated ${statedPostedOn}: ${plural(postedDaysAgo, "day", "days")} ago.`
        : `Posted ${plural(postedDaysAgo, "day", "days")} ago by the board's own date.`,
    );
  }
  if (firstSeenDaysAgo !== null && timesSeen > 0) {
    reasons.push(
      `First seen here ${plural(firstSeenDaysAgo, "day", "days")} ago, on ${plural(timesSeen, "search", "searches")}.`,
    );
  }
  if (reposts > 0) {
    reasons.push(`Re-dated ${plural(reposts, "time", "times")} since first seen (the posting date moved forward).`);
  }
  if (closingPassed) {
    reasons.push(`The stated closing date ${closesOn} has passed.`);
  }

  // The verdict: the oldest evidence wins, because a ghost job is defined
  // by how long it has really been open, not by its most recent facelift.
  const ageDays = Math.max(postedDaysAgo ?? -1, firstSeenDaysAgo ?? -1);
  let level: FreshnessLevel;
  if (closingPassed || reposts >= REPOSTS_FOR_STALE || ageDays >= STALE_FROM_DAYS) {
    level = "stale";
  } else if (ageDays >= FRESH_UNDER_DAYS) {
    level = "aging";
  } else if (ageDays >= 0) {
    level = "fresh";
  } else {
    level = "unknown";
    reasons.push("The board states no posting date and this product has not seen the posting before.");
  }

  return Object.freeze({
    level,
    postedDaysAgo,
    firstSeenDaysAgo,
    timesSeen,
    reposts,
    reasons: Object.freeze(reasons),
  });
}

/** The label a badge carries; fresh postings carry none (NEW already exists). */
export function freshnessLabel(level: FreshnessLevel): string | null {
  switch (level) {
    case "stale":
      return "Likely stale";
    case "aging":
      return "Aging";
    default:
      return null;
  }
}

/** Ledger rows as PostgREST returns them, mapped to the evaluator's shape. */
export function toSighting(row: Record<string, unknown>): Sighting {
  return {
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    timesSeen: Number(row.times_seen ?? 0),
    earliestPostedOn: (row.earliest_posted_on as string | null) ?? null,
    latestPostedOn: (row.latest_posted_on as string | null) ?? null,
    reposts: Number(row.reposts ?? 0),
    closesOn: (row.closes_on as string | null) ?? null,
  };
}
