/**
 * Trust (ADR-234): the pure side of the forecast scenario and the contact
 * hygiene report. The scenario's arithmetic lives in the database with the
 * factor printed per month; this file only maps rows and counts flags.
 */

/* --- forecast scenario ------------------------------------------------------ */

export type CrmForecastScenarioRow = {
  month: string;
  months_ahead: number;
  recorded_cents: number | string;
  scenario_cents: number | string;
  factor_bps: number;
  plans: number;
  contracts: number;
};

export type ForecastScenarioMonthView = {
  month: string;
  monthsAhead: number;
  recordedCents: number;
  scenarioCents: number;
  factorBps: number;
  plans: number;
  contracts: number;
};

export function toForecastScenarioMonthView(row: CrmForecastScenarioRow): ForecastScenarioMonthView {
  return {
    month: String(row.month).slice(0, 10),
    monthsAhead: row.months_ahead,
    recordedCents: Number(row.recorded_cents),
    scenarioCents: Number(row.scenario_cents),
    factorBps: row.factor_bps,
    plans: row.plans,
    contracts: row.contracts,
  };
}

export type CrmForecastAssumptionsRow = {
  id: string;
  annual_churn_bps: number;
  annual_growth_bps: number;
  note: string | null;
  updated_by: string;
  updated_at: string;
};

export type ForecastAssumptionsView = {
  id: string;
  annualChurnBps: number;
  annualGrowthBps: number;
  note: string | null;
  updatedBy: string;
  updatedAt: string;
};

export const CRM_FORECAST_ASSUMPTIONS_COLUMNS = "id, annual_churn_bps, annual_growth_bps, note, updated_by, updated_at";

export function toForecastAssumptionsView(row: CrmForecastAssumptionsRow): ForecastAssumptionsView {
  return {
    id: row.id,
    annualChurnBps: row.annual_churn_bps,
    annualGrowthBps: row.annual_growth_bps,
    note: row.note,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/** Clamp a basis-point input to the 0–100% the function accepts; null when absent or unreadable. */
export function readBps(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(10_000, Math.max(0, Math.round(parsed)));
}

export type ScenarioTotals = {
  recordedCents: number;
  scenarioCents: number;
  /** Scenario minus recorded over the whole window: what the assumptions add or take away. */
  differenceCents: number;
};

export function totalScenario(months: ReadonlyArray<ForecastScenarioMonthView>): ScenarioTotals {
  const recordedCents = months.reduce((sum, month) => sum + month.recordedCents, 0);
  const scenarioCents = months.reduce((sum, month) => sum + month.scenarioCents, 0);
  return { recordedCents, scenarioCents, differenceCents: scenarioCents - recordedCents };
}

/* --- contact hygiene -------------------------------------------------------- */

export const HYGIENE_FLAG_LABELS: Readonly<Record<string, string>> = {
  unreachable: "No email and no phone",
  undeliverable: "A notice to this address or number failed",
  duplicate_email: "Same email on another contact",
  inactive_account: "Account is inactive",
  untouched_year: "Nothing on the account in a year",
};

export type CrmContactHygieneRow = {
  contact_id: string;
  account_id: string;
  account_name: string;
  account_status: string;
  contact_name: string;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  last_touch_at: string | null;
  days_since_touch: number | null;
  flags: string[];
  flag_count: number;
};

export type ContactHygieneView = {
  contactId: string;
  accountId: string;
  accountName: string;
  accountStatus: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  lastTouchAt: string | null;
  daysSinceTouch: number | null;
  flags: string[];
  labels: string[];
  flagCount: number;
};

export function toContactHygieneView(row: CrmContactHygieneRow): ContactHygieneView {
  const flags = Array.isArray(row.flags) ? row.flags : [];
  return {
    contactId: row.contact_id,
    accountId: row.account_id,
    accountName: row.account_name,
    accountStatus: row.account_status,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    isPrimary: row.is_primary,
    lastTouchAt: row.last_touch_at,
    daysSinceTouch: row.days_since_touch,
    flags,
    labels: flags.map((flag) => HYGIENE_FLAG_LABELS[flag] ?? flag.replace(/_/g, " ")),
    flagCount: row.flag_count,
  };
}

export type HygieneSummary = {
  contacts: number;
  byFlag: Array<{ flag: string; label: string; count: number }>;
  /** Contacts carrying more than one reason: the ones to look at first. */
  multiFlagged: number;
};

export function summarizeHygiene(rows: ReadonlyArray<ContactHygieneView>): HygieneSummary {
  const counts = new Map<string, number>();
  let multiFlagged = 0;
  for (const row of rows) {
    if (row.flagCount > 1) multiFlagged += 1;
    for (const flag of row.flags) counts.set(flag, (counts.get(flag) ?? 0) + 1);
  }
  const byFlag = Object.keys(HYGIENE_FLAG_LABELS)
    .filter((flag) => counts.has(flag))
    .map((flag) => ({ flag, label: HYGIENE_FLAG_LABELS[flag], count: counts.get(flag) ?? 0 }));
  for (const [flag, count] of counts) {
    if (!(flag in HYGIENE_FLAG_LABELS)) byFlag.push({ flag, label: flag.replace(/_/g, " "), count });
  }
  return { contacts: rows.length, byFlag, multiFlagged };
}
