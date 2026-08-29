/**
 * What the Job Discovery page displays, and what it refuses to display.
 *
 * The owner's design shows five headline figures, a credit meter, and a filter
 * bar. Every one of them is a count over rows this module reads; none is a
 * constant chosen to look plausible. Where the data cannot answer, the type
 * says `null` and the page renders an honest blank rather than a zero — a zero
 * is a measurement, and "we did not measure" is not zero.
 */

/** Rolling window for both the credit meter and the "this week" deltas. */
export const DISCOVERY_WINDOW_DAYS = 7;

export type DiscoveryJob = {
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly location: string | null;
  readonly salaryText: string | null;
  readonly workModel: string | null;
  readonly source: string;
  readonly url: string | null;
  readonly description: string | null;
  readonly discoveredAt: string;
  readonly savedAt: string | null;
  readonly match: {
    readonly score: number;
    readonly breakdown: Readonly<Record<string, number>>;
    readonly reasons: readonly string[];
    readonly gaps: readonly string[];
    readonly threshold: number;
    readonly qualified: boolean;
  } | null;
  readonly application: { readonly id: string; readonly stage: string } | null;
};

export type DiscoveryHeadline = {
  readonly label: string;
  readonly value: number;
  /** New in the window, or null when a delta is not meaningful for this figure. */
  readonly delta: number | null;
};

function withinWindow(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  return now - at <= DISCOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000 && at <= now;
}

/**
 * The five figures across the top, derived from the same jobs the list renders.
 *
 * Deliberately computed from one array rather than five queries: a headline
 * that disagrees with the list beneath it is the most corrosive thing this
 * page could do, and separate counts would eventually drift.
 *
 * "High match" uses each job's own recorded threshold, not a constant 80. The
 * threshold is a per-seeker preference, and a page that hard-codes 80 would
 * mislabel every workspace that changed it.
 */
export function discoveryHeadlines(
  jobs: readonly DiscoveryJob[],
  counts: { readonly appliedThisWeek: number; readonly activeAlerts: number },
  now: number = Date.now(),
): readonly DiscoveryHeadline[] {
  let high = 0;
  let highNew = 0;
  let saved = 0;
  let opportunitiesNew = 0;

  for (const job of jobs) {
    const fresh = withinWindow(job.discoveredAt, now);
    if (fresh) opportunitiesNew += 1;
    if (job.match && job.match.score >= job.match.threshold) {
      high += 1;
      if (fresh) highNew += 1;
    }
    if (job.savedAt) saved += 1;
  }

  return [
    { label: "New Opportunities", value: jobs.length, delta: opportunitiesNew },
    { label: "High Match", value: high, delta: highNew },
    { label: "Applied This Week", value: counts.appliedThisWeek, delta: null },
    { label: "Saved Jobs", value: saved, delta: null },
    { label: "Search Alerts", value: counts.activeAlerts, delta: null },
  ];
}

/**
 * The qualification bar this list is being measured against, or null when no
 * job carries one.
 *
 * The design's card reads "High Match (80%+)". Eighty is the default, not a
 * law, so the label is built from what the rows actually say. When postings
 * disagree — a threshold changed between recordings — there is no single bar
 * to name and the caller drops the qualifier rather than picking one.
 */
export function activeThreshold(jobs: readonly DiscoveryJob[]): number | null {
  const seen = new Set<number>();
  for (const job of jobs) if (job.match) seen.add(job.match.threshold);
  return seen.size === 1 ? [...seen][0] : null;
}

export type CreditMeter = {
  readonly used: number;
  readonly allowance: number;
  readonly percent: number;
  readonly remaining: number;
};

/**
 * The search meter, from counted events and a stored allowance.
 *
 * Returns null when there is no allowance to measure against, so the page can
 * omit the meter instead of drawing an empty bar. `percent` is clamped because
 * an allowance can be lowered below what has already been spent, and a bar
 * past 100% renders as a broken component rather than as the overage it is —
 * `remaining` goes to zero and carries that fact instead.
 */
export function creditMeter(used: number, allowance: number | null | undefined): CreditMeter | null {
  if (typeof allowance !== "number" || !Number.isFinite(allowance) || allowance <= 0) return null;
  const spent = Math.max(0, Math.round(used));
  return {
    used: spent,
    allowance,
    percent: Math.min(100, Math.round((spent / allowance) * 100)),
    remaining: Math.max(0, allowance - spent),
  };
}

export type DiscoveryFilters = {
  readonly text: string;
  readonly workModel: string | null;
  readonly location: string | null;
  readonly minimumScore: number | null;
  readonly savedOnly: boolean;
};

export const EMPTY_FILTERS: DiscoveryFilters = {
  text: "",
  workModel: null,
  location: null,
  minimumScore: null,
  savedOnly: false,
};

export function filtersActive(filters: DiscoveryFilters): boolean {
  return filters.text.trim() !== ""
    || filters.workModel !== null
    || filters.location !== null
    || filters.minimumScore !== null
    || filters.savedOnly;
}

/**
 * Filtering, over the rows already fetched.
 *
 * Text matches title, company and location — the three fields a person reads
 * off a card — so a search for what they can see finds it. An unscored job is
 * excluded by a minimum-score filter rather than treated as zero: it has no
 * score, and scoring it zero would rank it as a bad match instead of an
 * unmeasured one.
 */
export function applyFilters(
  jobs: readonly DiscoveryJob[],
  filters: DiscoveryFilters,
): readonly DiscoveryJob[] {
  const needle = filters.text.trim().toLowerCase();
  return jobs.filter((job) => {
    if (needle) {
      const haystack = `${job.title} ${job.company} ${job.location ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (filters.workModel && job.workModel !== filters.workModel) return false;
    if (filters.location && job.location !== filters.location) return false;
    if (filters.savedOnly && !job.savedAt) return false;
    if (filters.minimumScore !== null) {
      if (!job.match) return false;
      if (job.match.score < filters.minimumScore) return false;
    }
    return true;
  });
}

export const SORT_OPTIONS = [
  { key: "score", label: "Match Score (High to Low)" },
  { key: "recent", label: "Recently Discovered" },
  { key: "company", label: "Company (A–Z)" },
] as const;
export type SortKey = (typeof SORT_OPTIONS)[number]["key"];

/**
 * Sorting, with unscored jobs last under a score sort.
 *
 * A job with no match has not been measured, so it sorts below every measured
 * one rather than above the worst — the alternative reads as "this is the
 * weakest match" when the truth is "this one was never scored".
 */
export function sortJobs(
  jobs: readonly DiscoveryJob[],
  key: SortKey,
): readonly DiscoveryJob[] {
  const sorted = [...jobs];
  if (key === "company") {
    sorted.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
    return sorted;
  }
  if (key === "recent") {
    sorted.sort((a, b) => Date.parse(b.discoveredAt) - Date.parse(a.discoveredAt));
    return sorted;
  }
  sorted.sort((a, b) => {
    const left = a.match?.score;
    const right = b.match?.score;
    if (left === undefined && right === undefined) {
      return Date.parse(b.discoveredAt) - Date.parse(a.discoveredAt);
    }
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return right - left || Date.parse(b.discoveredAt) - Date.parse(a.discoveredAt);
  });
  return sorted;
}

export const PAGE_SIZE = 10;

export type Page<T> = {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageCount: number;
  readonly from: number;
  readonly to: number;
  readonly total: number;
};

/**
 * One page, with the range a person reads as "showing 1 to 10 of 247".
 *
 * `from` is 1-based and `to` is inclusive because that is how the sentence
 * reads; an empty list reports 0 to 0 rather than 1 to 0, which is the shape
 * that sentence takes when there is nothing to show.
 */
export function paginate<T>(items: readonly T[], page: number, size = PAGE_SIZE): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: current,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + slice.length,
    total,
  };
}

/**
 * The page numbers to render, with gaps where numbers were dropped.
 *
 * The design shows `1 2 3 4 5 … 25`: the run around the current page, the
 * last page always, and an ellipsis standing for what was removed. Returning
 * the ellipsis as a value rather than letting the component insert one keeps
 * the decision here, where it can be tested.
 */
export function pageWindow(page: number, pageCount: number, span = 5): readonly (number | "gap")[] {
  if (pageCount <= span + 1) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const half = Math.floor(span / 2);
  let start = Math.max(1, page - half);
  const end = Math.min(pageCount - 1, start + span - 1);
  start = Math.max(1, Math.min(start, end - span + 1));

  const window: (number | "gap")[] = [];
  for (let index = start; index <= end; index += 1) window.push(index);
  if (end < pageCount - 1) window.push("gap");
  window.push(pageCount);
  return window;
}

/**
 * The skills behind a match, strongest first.
 *
 * `breakdown` is the scorer's own per-criterion contribution, so this is the
 * evidence for the score rather than a second list that could disagree with
 * it. Zero and negative contributions are dropped: a criterion that added
 * nothing is not a "matching skill".
 */
export function topMatchingSkills(
  breakdown: Readonly<Record<string, number>> | undefined,
  limit = 6,
): readonly string[] {
  if (!breakdown) return [];
  return Object.entries(breakdown)
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}
