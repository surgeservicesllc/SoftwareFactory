/**
 * Dates, formatted without taking the page down.
 *
 * `new Intl.DateTimeFormat().format(new Date(value))` throws `RangeError:
 * Invalid time value` for anything it cannot parse — and an uncaught throw
 * during a React render unmounts the whole tree, so one row with an odd
 * timestamp blanks the entire console rather than showing one odd cell.
 *
 * Six components had their own copy of this formatter. Every one guarded
 * against `null` and none against an unparseable string, which is the case
 * that actually arrives: a column added by a migration that has not been
 * applied yet, a projection returning a different shape, a value that made a
 * round trip through JSON as something other than an ISO string.
 *
 * The fallback is a dash rather than "now" or the epoch: an unknown time is
 * unknown, and showing a plausible-looking wrong timestamp is worse than
 * admitting there isn't one.
 */

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const DATE_ONLY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** What to show when there is no usable time. */
export const NO_DATE = "—";

function parse(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateTime(value: unknown, fallback: string = NO_DATE): string {
  const parsed = parse(value);
  return parsed ? DATE_TIME.format(parsed) : fallback;
}

export function formatDate(value: unknown, fallback: string = NO_DATE): string {
  const parsed = parse(value);
  return parsed ? DATE_ONLY.format(parsed) : fallback;
}

/** True when a value would render as a real time rather than the fallback. */
export function isFormattableDate(value: unknown): boolean {
  return parse(value) !== null;
}
