/**
 * Explainable scoring (ADR-229).
 *
 * A score is a SUM of named rules. Each rule has editable points, and each
 * point on an account's score is printed with the fact that earned it —
 * so "72" always comes with "estimate sent (+15), commercial (+15), three
 * locations (+15), no activity in 30 days (−10)" and any line can be
 * argued with. The engine is `crm_score_accounts`, computed live from the
 * workspace's rows; nothing about an account's score is stored.
 */

export const CRM_SCORING_MODELS = ["lead", "churn", "upsell"] as const;
export type CrmScoringModel = (typeof CRM_SCORING_MODELS)[number];

export const SCORING_MODEL_LABEL: Record<CrmScoringModel, { title: string; scores: string; description: string }> = {
  lead: {
    title: "Lead score",
    scores: "leads and prospects",
    description: "How warm a lead or prospect is, from what is on file and what has happened.",
  },
  churn: {
    title: "Churn risk",
    scores: "customers",
    description: "How much a customer is at risk, from missed service, money owed and silence.",
  },
  upsell: {
    title: "Upsell",
    scores: "customers",
    description: "Where a customer has room to buy more, from gaps in coverage and renewals due.",
  },
};

/**
 * The defaults, mirrored from `crm_scoring_defaults()` so the page can name
 * every rule before the first read. A contract test compares this list to
 * the database's, so they cannot drift apart silently.
 */
export const SCORING_DEFAULTS: ReadonlyArray<{
  model: CrmScoringModel;
  ruleKey: string;
  label: string;
  points: number;
}> = [
  { model: "lead", ruleKey: "has_email", label: "Email on file", points: 10 },
  { model: "lead", ruleKey: "has_phone", label: "Phone on file", points: 10 },
  { model: "lead", ruleKey: "source_recorded", label: "Source recorded", points: 5 },
  { model: "lead", ruleKey: "commercial", label: "Commercial account", points: 15 },
  { model: "lead", ruleKey: "service_locations", label: "Service locations on file (per location, up to four)", points: 5 },
  { model: "lead", ruleKey: "open_opportunity", label: "An open opportunity", points: 10 },
  { model: "lead", ruleKey: "opportunity_value", label: "An open opportunity worth at least $1,000", points: 10 },
  { model: "lead", ruleKey: "estimate_sent", label: "An estimate sent", points: 15 },
  { model: "lead", ruleKey: "portal_request", label: "Asked for service through the portal", points: 10 },
  { model: "lead", ruleKey: "activity_7d", label: "Activity in the last 7 days", points: 15 },
  { model: "lead", ruleKey: "activity_30d", label: "Activity in the last 30 days", points: 5 },
  { model: "lead", ruleKey: "silent_30d", label: "No activity in 30 days", points: -10 },
  { model: "churn", ruleKey: "visit_overdue", label: "An active plan more than 14 days past due", points: 25 },
  { model: "churn", ruleKey: "no_visit_90d", label: "An active plan but no completed visit in 90 days", points: 20 },
  { model: "churn", ruleKey: "cancelled_visits_90d", label: "Cancelled visits in 90 days (per visit, up to three)", points: 10 },
  { model: "churn", ruleKey: "overdue_invoice", label: "An invoice past due", points: 20 },
  { model: "churn", ruleKey: "unresolved_sighting", label: "A sighting without corrective action", points: 15 },
  { model: "churn", ruleKey: "contract_ending_60d", label: "A contract ending within 60 days", points: 15 },
  { model: "churn", ruleKey: "request_unanswered", label: "A portal request not yet acknowledged", points: 10 },
  { model: "churn", ruleKey: "silent_90d", label: "No activity in 90 days", points: 10 },
  { model: "upsell", ruleKey: "location_without_plan", label: "A service location with no active plan", points: 20 },
  { model: "upsell", ruleKey: "sighting_without_plan", label: "A sighting at a location with no active plan", points: 25 },
  { model: "upsell", ruleKey: "wdo_stale", label: "No WDO inspection issued in the last 12 months", points: 15 },
  { model: "upsell", ruleKey: "estimate_accepted_no_contract", label: "An accepted estimate with no active contract", points: 20 },
  { model: "upsell", ruleKey: "contract_renewal_90d", label: "A contract ending within 90 days", points: 15 },
  { model: "upsell", ruleKey: "one_off_visits", label: "Three or more one-off visits in six months", points: 20 },
  { model: "upsell", ruleKey: "commercial_without_ipm", label: "Commercial account with no monitoring stations", points: 15 },
];

export type ScoreLine = { rule: string; label: string; points: number; fact: string };

export type CrmScoreRow = {
  account_id: string;
  score: number;
  breakdown: ScoreLine[];
};

export type CrmEffectiveRuleRow = {
  rule_key: string;
  label: string;
  points: number;
  default_points: number;
  active: boolean;
  overridden: boolean;
};

export function toEffectiveRuleView(row: CrmEffectiveRuleRow) {
  return {
    ruleKey: row.rule_key,
    label: row.label,
    points: row.points,
    defaultPoints: row.default_points,
    active: row.active,
    overridden: row.overridden,
  };
}
export type EffectiveRuleView = ReturnType<typeof toEffectiveRuleView>;

export type ScoredAccountView = {
  accountId: string;
  name: string;
  kind: string;
  status: string;
  score: number;
  breakdown: ScoreLine[];
};

/** "+15" / "−10", for the chips. */
export function signedPoints(points: number): string {
  return points < 0 ? `−${Math.abs(points)}` : `+${points}`;
}
