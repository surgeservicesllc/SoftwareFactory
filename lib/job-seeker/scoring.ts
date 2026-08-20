/**
 * The Job Seeker match score: seven weighted components, 0-100 total.
 *
 * The weights are the published contract of the AI Match feature, and they
 * live in exactly two places: here, for the application, and in the schema's
 * `job_seeker_breakdown_valid`, which refuses any stored breakdown whose
 * components exceed them or whose total is not the sum. The behavior test
 * holds the two definitions equal, so a weight change is a deliberate,
 * two-sided edit — never drift.
 *
 * Scoring itself is deterministic code. Model-assisted extraction can feed
 * the component judgments, but the arithmetic that turns judgments into a
 * number is not a model's to improvise: the same breakdown always produces
 * the same score, and the score is always auditable against its parts.
 */

export const JOB_SEEKER_WEIGHTS = {
  experience: 30,
  skills: 20,
  leadership: 15,
  industry: 10,
  compensation: 10,
  location: 10,
  career_growth: 5,
} as const;

export type MatchComponent = keyof typeof JOB_SEEKER_WEIGHTS;

export type MatchBreakdown = Readonly<Record<MatchComponent, number>>;

export type ScoredMatch = Readonly<{
  score: number;
  breakdown: MatchBreakdown;
  reasons: readonly string[];
  gaps: readonly string[];
  threshold: number;
  qualified: boolean;
}>;

/** The design default; each person may move it on their preferences. */
export const DEFAULT_QUALIFICATION_THRESHOLD = 80;

function clampComponent(component: MatchComponent, value: number): number {
  const weight = JOB_SEEKER_WEIGHTS[component];
  if (!Number.isFinite(value)) return 0;
  return Math.min(weight, Math.max(0, Math.round(value)));
}

/**
 * Turns component judgments into the stored match. Inputs outside a
 * component's weight are clamped rather than trusted — the schema would
 * refuse them anyway, and a clamp names the intent while a CHECK names the
 * bug. Reasons and gaps travel with the score so the number never stands
 * without its evidence.
 */
export function scoreJob(input: Readonly<{
  breakdown: Partial<Record<MatchComponent, number>>;
  threshold?: number;
  reasons?: readonly string[];
  gaps?: readonly string[];
}>): ScoredMatch {
  const breakdown = Object.fromEntries(
    (Object.keys(JOB_SEEKER_WEIGHTS) as MatchComponent[]).map((component) => [
      component,
      clampComponent(component, input.breakdown[component] ?? 0),
    ]),
  ) as Record<MatchComponent, number>;

  const score = (Object.values(breakdown) as number[]).reduce((sum, value) => sum + value, 0);
  const threshold = Math.min(100, Math.max(0,
    Math.round(input.threshold ?? DEFAULT_QUALIFICATION_THRESHOLD)));

  return {
    score,
    breakdown,
    reasons: (input.reasons ?? []).map((reason) => reason.trim()).filter(Boolean).slice(0, 50),
    gaps: (input.gaps ?? []).map((gap) => gap.trim()).filter(Boolean).slice(0, 50),
    threshold,
    qualified: score >= threshold,
  };
}
