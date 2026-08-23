import { z } from "zod";

/**
 * Typed stage packages for DISCOVER → EVALUATE → DECIDE.
 *
 * The owner's lifecycle design hands each stage's result forward as a
 * structured package rather than prose — "typed/versioned schemas so
 * downstream agents receive deterministic context". These are those schemas,
 * for the three stages ADR-136 left dormant until something could produce
 * them. The `open_source_scout` template's nodes now do, and these contracts
 * are what `validateNodeOutput` holds their answers to.
 *
 * One honesty rule shapes every field here. The node executor that produces
 * these packages reads with Read/Glob/Grep and has **no network access**, so
 * a candidate can be grounded in exactly three ways: a path in this
 * repository, a dependency already in the manifest, or the model's own
 * training knowledge. The schema forces each candidate to say which
 * (`source`), and popularity metrics — stars, forks, recent-commit dates —
 * are deliberately absent: the executor cannot observe them, and a recalled
 * number presented as a reading is exactly the fake data this repository
 * refuses. When live lookups exist (an owner-gated tool-surface change),
 * a `verification` of VERIFIED can start to mean more than "seen in this
 * repository".
 *
 * Versioned so a consumer can tell which contract a stored artifact honoured;
 * bump on any breaking change and keep the old parser until no artifact of
 * the old shape remains interesting.
 */

export const STAGE_PACKAGE_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------- discovery */

/** Where a candidate's existence is actually known from. */
export const CANDIDATE_SOURCES = [
  /** Code that already exists in this repository. */
  "REPOSITORY",
  /** A package already declared in this repository's manifests. */
  "DEPENDENCY",
  /** The model's training knowledge; nothing here observed it live. */
  "MODEL_KNOWLEDGE",
] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/**
 * What backs the candidate's claims. VERIFIED_IN_REPO means the evidence is a
 * path or manifest entry the node actually read; UNVERIFIED means the claim
 * rests on recollection and must be checked before anything is built on it.
 */
export const CANDIDATE_VERIFICATIONS = ["VERIFIED_IN_REPO", "UNVERIFIED"] as const;

const candidateSchema = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  source: z.enum(CANDIDATE_SOURCES),
  /** A repo path, a manifest entry, or "model recollection" — never blank. */
  evidence: z.string().min(1),
  verification: z.enum(CANDIDATE_VERIFICATIONS),
  /** 0–100: how well this candidate matches the stated requirement. */
  matchScore: z.number().min(0).max(100),
  strengths: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)),
  url: z.string().optional(),
  license: z.string().optional(),
  language: z.string().optional(),
}).strict()
  /*
   * The one cross-field rule that keeps the package honest: a candidate may
   * only claim repository verification when its existence is repository- or
   * manifest-grounded. Model knowledge is always unverified by definition.
   */
  .refine(
    (candidate) =>
      candidate.source !== "MODEL_KNOWLEDGE" || candidate.verification === "UNVERIFIED",
    { message: "A MODEL_KNOWLEDGE candidate cannot claim VERIFIED_IN_REPO." },
  );

export type DiscoveryCandidate = z.infer<typeof candidateSchema>;

/**
 * The DISCOVER stage's output.
 *
 * Lenient where the graph needs it to be: the parallel scan nodes each emit a
 * package holding only their own candidates, and the consolidating fan-in
 * emits the full one — same contract, so the fan-in can parse its inputs with
 * the schema that governs its own output.
 */
export const discoveryPackageSchema = z.object({
  schemaVersion: z.literal(STAGE_PACKAGE_SCHEMA_VERSION),
  searchAreas: z.array(z.string().min(1)).default([]),
  candidates: z.array(candidateSchema).max(25),
  keyFindings: z.array(z.string().min(1)).default([]),
  recommendedNextSteps: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
}).strict();

export type DiscoveryPackage = z.infer<typeof discoveryPackageSchema>;

/* ------------------------------------------------------------ evaluation */

/**
 * The ten scoring categories and their weights, summing to 100.
 *
 * Fixed rather than per-run: comparability across runs is the point of a
 * rubric, and a model free to reweight per answer will reweight toward
 * whatever it already concluded.
 */
export const EVALUATION_CRITERIA = Object.freeze({
  licenseLegal: 10,
  securitySafety: 15,
  maintenanceActivity: 15,
  featureCompleteness: 15,
  performanceScalability: 10,
  documentation: 10,
  communityEcosystem: 10,
  easeOfIntegration: 5,
  reliabilityTesting: 5,
  codeQuality: 5,
} as const);
export type EvaluationCriterion = keyof typeof EVALUATION_CRITERIA;

export const EVALUATION_RECOMMENDATIONS = [
  "STRONGLY_CONSIDER",
  "CONSIDER",
  "MAYBE",
  "LOW_PRIORITY",
  "NOT_RECOMMENDED",
] as const;

export const EVALUATION_RISK_LEVELS = [
  "LOW",
  "MEDIUM_LOW",
  "MEDIUM",
  "MEDIUM_HIGH",
  "HIGH",
] as const;

const criterionScore = z.number().min(0).max(10);

const scoredCandidateSchema = z.object({
  name: z.string().min(1),
  /** 0–10 per category; the weighted total is computed, not asserted. */
  scores: z.object({
    licenseLegal: criterionScore,
    securitySafety: criterionScore,
    maintenanceActivity: criterionScore,
    featureCompleteness: criterionScore,
    performanceScalability: criterionScore,
    documentation: criterionScore,
    communityEcosystem: criterionScore,
    easeOfIntegration: criterionScore,
    reliabilityTesting: criterionScore,
    codeQuality: criterionScore,
  }).strict(),
  riskLevel: z.enum(EVALUATION_RISK_LEVELS),
  recommendation: z.enum(EVALUATION_RECOMMENDATIONS),
  redFlags: z.array(z.string().min(1)).default([]),
  rationale: z.string().min(1),
}).strict();

export type ScoredCandidate = z.infer<typeof scoredCandidateSchema>;

/**
 * A candidate's weighted total, out of 100 — computed from the rubric rather
 * than carried in the package, so a stated total can never disagree with the
 * scores it claims to summarise.
 */
export function weightedTotal(candidate: Pick<ScoredCandidate, "scores">): number {
  const total = (Object.keys(EVALUATION_CRITERIA) as EvaluationCriterion[]).reduce(
    (sum, criterion) =>
      sum + candidate.scores[criterion] * (EVALUATION_CRITERIA[criterion] / 10),
    0,
  );
  return Math.round(total * 10) / 10;
}

/** The EVALUATE stage's output: every survivor scored on one rubric. */
export const evaluationPackageSchema = z.object({
  schemaVersion: z.literal(STAGE_PACKAGE_SCHEMA_VERSION),
  candidates: z.array(scoredCandidateSchema).min(1),
  /** Names in rank order; must be a permutation of the scored candidates. */
  ranking: z.array(z.string().min(1)).min(1),
  topCandidate: z.object({
    name: z.string().min(1),
    strengths: z.array(z.string().min(1)).min(1),
    limitations: z.array(z.string().min(1)),
    caveats: z.string().optional(),
  }).strict(),
  recommendationSummary: z.string().min(1),
  assumptions: z.array(z.string().min(1)).default([]),
}).strict().refine(
  (evaluation) => {
    const scored = new Set(evaluation.candidates.map((candidate) => candidate.name));
    return (
      evaluation.ranking.length === scored.size
      && evaluation.ranking.every((name) => scored.has(name))
      && scored.has(evaluation.topCandidate.name)
    );
  },
  { message: "The ranking must order exactly the scored candidates, and the top candidate must be one of them." },
);

export type EvaluationPackage = z.infer<typeof evaluationPackageSchema>;

/* -------------------------------------------------------------- decision */

/** The five paths a decision chooses among. Every decision must weigh all five. */
export const DECISION_PATHS = ["USE", "CONNECT", "ADAPT", "FORK", "BUILD"] as const;
export type DecisionPath = (typeof DECISION_PATHS)[number];

const weighedPathSchema = z.object({
  path: z.enum(DECISION_PATHS),
  /** 0–100 fitness against the requirement and constraints. */
  score: z.number().min(0).max(100),
  pros: z.array(z.string().min(1)).min(1),
  cons: z.array(z.string().min(1)).min(1),
  fitNotes: z.string().min(1),
}).strict();

/** The DECIDE stage's output: five paths weighed, one chosen, with the plan. */
export const decisionPackageSchema = z.object({
  schemaVersion: z.literal(STAGE_PACKAGE_SCHEMA_VERSION),
  /** All five, each exactly once — a decision that skipped a path is not one. */
  paths: z.array(weighedPathSchema).length(DECISION_PATHS.length),
  chosenPath: z.enum(DECISION_PATHS),
  /** What the choice applies to, e.g. the top candidate — or "" for BUILD. */
  subject: z.string(),
  rationale: z.array(z.string().min(1)).min(1),
  executionPlan: z.array(z.object({
    step: z.string().min(1),
    detail: z.string().min(1),
  }).strict()).min(1),
  integrationBoundaries: z.object({
    weOwn: z.array(z.string().min(1)),
    counterpartOwns: z.array(z.string().min(1)),
  }).strict(),
  risks: z.array(z.object({
    risk: z.string().min(1),
    mitigation: z.string().min(1),
  }).strict()).default([]),
  openQuestions: z.array(z.string().min(1)).default([]),
}).strict().refine(
  (decision) =>
    new Set(decision.paths.map((weighed) => weighed.path)).size === DECISION_PATHS.length,
  { message: "Every decision must weigh USE, CONNECT, ADAPT, FORK and BUILD exactly once." },
).refine(
  (decision) => decision.paths.some((weighed) => weighed.path === decision.chosenPath),
  { message: "The chosen path must be one of the weighed paths." },
);

export type DecisionPackage = z.infer<typeof decisionPackageSchema>;
