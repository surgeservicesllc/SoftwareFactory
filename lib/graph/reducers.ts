/**
 * Deterministic reducers.
 *
 * Filtering, counting, deduping, sorting, grouping, and joining are things code
 * does perfectly, repeatably, and for free. Handing them to a model costs money
 * and latency and introduces the one failure code does not have: quietly
 * inventing or dropping a row. So the reduce layer between fan-out and
 * synthesis is ordinary functions, and a model is only asked for judgement it
 * is uniquely able to give.
 *
 * Raw and reduced artifacts are kept separately by the caller (§12): the
 * reduction is a lossy view, and the evidence for a finding has to survive it.
 */

export type ReductionStats = {
  readonly inputCount: number;
  readonly outputCount: number;
  /** Fraction removed. 0.8 means the reduce dropped four of every five rows. */
  readonly reductionRatio: number;
};

export type Reduction<T> = {
  readonly items: readonly T[];
  readonly stats: ReductionStats;
};

function statsFor(inputCount: number, outputCount: number): ReductionStats {
  return {
    inputCount,
    outputCount,
    reductionRatio: inputCount === 0 ? 0 : 1 - outputCount / inputCount,
  };
}

/**
 * Remove duplicates by a caller-supplied identity.
 *
 * First occurrence wins, so the earliest evidence for a finding is the one
 * retained rather than an arbitrary survivor.
 */
export function dedupeBy<T>(items: readonly T[], identity: (item: T) => string): Reduction<T> {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = identity(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return { items: out, stats: statsFor(items.length, out.length) };
}

export function filterBy<T>(items: readonly T[], keep: (item: T) => boolean): Reduction<T> {
  const out = items.filter(keep);
  return { items: out, stats: statsFor(items.length, out.length) };
}

/** Stable sort by a numeric rank, highest first. */
export function sortByRank<T>(items: readonly T[], rank: (item: T) => number): readonly T[] {
  return [...items]
    .map((item, index) => ({ item, index, rank: rank(item) }))
    .sort((a, b) => (b.rank - a.rank) || (a.index - b.index))
    .map((entry) => entry.item);
}

export function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): ReadonlyMap<string, readonly T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket) bucket.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

export function countBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * Split into batches of at most `size`.
 *
 * This is what layered fan-in is built on: too many results for one synthesis
 * call become batches, each summarised, and the summaries synthesised.
 */
export function batch<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (size <= 0) throw new RangeError("Batch size must be positive.");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Normalise a free-text key for comparison: lowercase, collapse whitespace.
 * Used so "Missing Auth" and "missing  auth" dedupe to one finding.
 */
export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export type SeverityRank = Readonly<Record<string, number>>;

export const DEFAULT_SEVERITY_RANK: SeverityRank = Object.freeze({
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
});

export function rankSeverity(
  severity: string,
  ranks: SeverityRank = DEFAULT_SEVERITY_RANK,
): number {
  return ranks[normalizeKey(severity)] ?? 0;
}
