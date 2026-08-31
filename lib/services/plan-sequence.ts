/**
 * Plan sequencing: the calendar a service plan actually runs on (ADR-211).
 *
 * This is the browser-side twin of `crm_plan_step_date`,
 * `crm_plan_occurrences` and `crm_plan_cadence`. It exists so the schedule
 * editor can show the next dates as somebody types, before anything is
 * saved — a preview that asked the server for every keystroke would be
 * slower and would still be wrong for unsaved rows.
 *
 * Two implementations of one rule is a liability unless they are pinned
 * together, so services-plan-sequencing.behavior runs both over the same
 * steps across three years and fails if a single date differs. Change one,
 * change the other, or the suite stops you — the same arrangement the
 * secret detectors use.
 *
 * All arithmetic is UTC, like `advanceServiceDate`. A schedule that shifted
 * by a day for a technician in a different timezone would be a bug nobody
 * could reproduce.
 */

export type PlanStepAnchor = "day_of_month" | "nth_weekday";

export type PlanStep = {
  position: number;
  monthOffset: number;
  anchor: PlanStepAnchor;
  dayOfMonth: number | null;
  weekOfMonth: number | null;
  weekday: number | null;
  serviceType: string | null;
};

export type PlanOccurrence = {
  stepPosition: number;
  occursOn: string;
  serviceType: string | null;
};

/** Cycle lengths that divide the year. Anything else drifts every January. */
export const PLAN_CYCLE_MONTHS = [1, 2, 3, 4, 6, 12] as const;
export type PlanCycleMonths = (typeof PLAN_CYCLE_MONTHS)[number];

export function isPlanCycleMonths(value: number): value is PlanCycleMonths {
  return (PLAN_CYCLE_MONTHS as readonly number[]).includes(value);
}

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * One step, one month, one date.
 *
 * Day 31 in a 30-day month is the 30th: "the 31st" is how an operator
 * writes "month end". Week 5 means the LAST matching weekday, so "last
 * Friday" still lands in a month with only four Fridays.
 */
export function planStepDate(year: number, month: number, step: PlanStep): string {
  const lastDay = daysInMonth(year, month);

  if (step.anchor === "day_of_month") {
    return isoDate(year, month, Math.min(step.dayOfMonth ?? 1, lastDay));
  }

  const weekday = step.weekday ?? 0;
  const week = step.weekOfMonth ?? 1;

  if (week === 5) {
    return isoDate(year, month, lastDay - ((weekdayOf(year, month, lastDay) - weekday + 7) % 7));
  }

  const firstMatch = 1 + ((weekday - weekdayOf(year, month, 1) + 7) % 7);
  const day = firstMatch + (week - 1) * 7;
  if (day > lastDay) {
    return isoDate(year, month, lastDay - ((weekdayOf(year, month, lastDay) - weekday + 7) % 7));
  }
  return isoDate(year, month, day);
}

/**
 * The next `count` visits from `from` inclusive, in date order.
 *
 * Cycles are anchored to the calendar: a step at month offset k falls in
 * every month where (month - 1) % cycle === k. March/June/September/
 * November stays those months forever, whoever edits the plan.
 */
export function planOccurrences(
  steps: readonly PlanStep[],
  cycleMonths: number | null,
  from: string,
  count: number,
  planServiceType: string | null = null,
): PlanOccurrence[] {
  if (cycleMonths === null || steps.length === 0) return [];

  const wanted = Math.min(Math.max(count, 1), 240);
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const horizon = wanted * cycleMonths + 12;
  const found: PlanOccurrence[] = [];

  for (let offset = 0; offset <= horizon; offset += 1) {
    const monthIndex = fromMonth - 1 + offset;
    const year = fromYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const due = steps.filter((step) => (month - 1) % cycleMonths === step.monthOffset);

    for (const step of due) {
      const occursOn = planStepDate(year, month, step);
      if (occursOn < from) continue;
      found.push({
        stepPosition: step.position,
        occursOn,
        serviceType: step.serviceType ?? planServiceType,
      });
    }
  }

  found.sort((left, right) =>
    left.occursOn === right.occursOn
      ? left.stepPosition - right.stepPosition
      : left.occursOn < right.occursOn ? -1 : 1);
  return found.slice(0, wanted);
}

/** The first visit strictly after `after`, or null for an unsequenced plan. */
export function planNextOccurrence(
  steps: readonly PlanStep[],
  cycleMonths: number | null,
  after: string,
): string | null {
  const [year, month, day] = after.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return planOccurrences(steps, cycleMonths, from, 1)[0]?.occursOn ?? null;
}

const BILLS_PER_YEAR = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  bimonthly: 6,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
} as const;

export type PlanCadence = {
  sequenced: boolean;
  visitsPerYear: number | null;
  billsPerYear: number;
};

/**
 * Visits and bills, side by side, because they are allowed to disagree.
 *
 * Level billing — pay monthly, serviced quarterly — is a normal pest
 * arrangement, so 4 visits against 12 bills is a sale rather than a fault.
 * Stating both is how an operator confirms the one they meant.
 */
export function planCadence(
  steps: readonly PlanStep[],
  cycleMonths: number | null,
  recurrence: keyof typeof BILLS_PER_YEAR,
): PlanCadence {
  const sequenced = cycleMonths !== null && steps.length > 0;
  return {
    sequenced,
    visitsPerYear: sequenced ? steps.length * (12 / (cycleMonths as number)) : null,
    billsPerYear: BILLS_PER_YEAR[recurrence],
  };
}
