import { z } from "zod";

import { SDLC_STAGES, type SdlcStage } from "@/lib/sdlc/lifecycle";

/**
 * The contracts each stage hands the next one.
 *
 * A lifecycle where every stage passes prose forward is a lifecycle where each
 * agent re-reads and re-interprets the last one's essay. The interpretation is
 * where the drift happens: DECIDE picks a candidate DISCOVER never actually
 * found, ARCHITECT designs for a decision that was never made, and nothing
 * notices because prose accommodates anything.
 *
 * So a stage's terminal node emits a *package* with a declared shape, and the
 * next stage receives structure. The engine validates it at the handoff
 * boundary the same way it validates every other node contract — this module
 * only says what the shapes are.
 *
 * ## Versioning
 *
 * Every package carries its own version literal. That is not ceremony: these
 * are stored in `graph_artifacts.payload` and read back by a later run, so a
 * package written under one shape has to be recognisable as such when the shape
 * moves. A reader that finds `version: 1` where it expected 2 knows what it is
 * looking at; one that finds an unversioned object can only guess.
 */

export const STAGE_ARTIFACT_VERSION = 1;

const version = z.literal(STAGE_ARTIFACT_VERSION);
const nonEmpty = z.string().trim().min(1);
const severity = z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const checkStatus = z.enum(["PASS", "FAIL", "SKIPPED"]);

/**
 * The requirement package.
 *
 * `acceptanceCriteria` carries `verifiedBy` because a criterion nobody can say
 * how to check is a wish. It is what TEST is later held against.
 */
export const requirementPackage = z.object({
  version,
  stage: z.literal("REQUIREMENT"),
  objective: nonEmpty,
  scope: z.object({ included: z.array(nonEmpty), excluded: z.array(nonEmpty) }),
  constraints: z.array(nonEmpty),
  acceptanceCriteria: z.array(
    z.object({ id: nonEmpty, statement: nonEmpty, verifiedBy: nonEmpty }),
  ).min(1),
  assumptions: z.array(nonEmpty),
  integrations: z.array(nonEmpty),
  dependencies: z.array(nonEmpty),
  risks: z.array(z.object({ description: nonEmpty, severity })),
  successMetrics: z.array(nonEmpty),
  priorities: z.array(nonEmpty),
});

/**
 * The discovery package.
 *
 * `searched` is as load-bearing as `candidates`: "we found nothing" and "we did
 * not look" produce the same empty list, and only the first is an answer. Every
 * candidate names its `source` for the same reason — an entry no one can go and
 * check is an assertion, and this stage's whole job is to stop those entering
 * the lifecycle.
 */
export const discoveryPackage = z.object({
  version,
  stage: z.literal("DISCOVER"),
  searched: z.array(z.object({ where: nonEmpty, query: nonEmpty, resultCount: z.number().int().min(0) })),
  candidates: z.array(
    z.object({
      id: nonEmpty,
      name: nonEmpty,
      origin: z.enum(["INTERNAL", "PACKAGE", "SERVICE", "PRIOR_ART"]),
      source: nonEmpty,
      licence: z.string().nullable(),
      lastActivity: z.string().nullable(),
      documentation: z.string().nullable(),
      relevance: nonEmpty,
    }),
  ),
  excluded: z.array(z.object({ name: nonEmpty, reason: nonEmpty })),
});

/**
 * The evaluation package.
 *
 * A score with no `evidence` beside it is a number someone felt, so the two
 * travel together and the matrix cannot be assembled without them.
 */
export const evaluationPackage = z.object({
  version,
  stage: z.literal("EVALUATE"),
  criteria: z.array(nonEmpty).min(1),
  scores: z.array(
    z.object({
      candidateId: nonEmpty,
      criterion: nonEmpty,
      score: z.number().min(0).max(5),
      evidence: nonEmpty,
    }),
  ),
  risks: z.array(z.object({ candidateId: nonEmpty, description: nonEmpty, severity })),
  recommendation: z.object({ candidateId: z.string().nullable(), rationale: nonEmpty }),
});

/** The decision package: use, connect, adapt, fork or build, and why. */
export const decisionPackage = z.object({
  version,
  stage: z.literal("DECIDE"),
  choice: z.enum(["USE", "CONNECT", "ADAPT", "FORK", "BUILD"]),
  // Null when the decision is BUILD, which chooses no candidate by definition.
  candidateId: z.string().nullable(),
  evidence: z.array(nonEmpty).min(1),
  tradeOffs: z.array(nonEmpty),
  integrationBoundary: nonEmpty,
  risks: z.array(z.object({ description: nonEmpty, severity })),
  executionStrategy: nonEmpty,
});

/**
 * The architecture package.
 *
 * `tasks` is the reason this stage exists in a graph engine rather than a
 * document: it is the next stage's node list, with the dependencies that decide
 * what runs in parallel already stated.
 */
export const architecturePackage = z.object({
  version,
  stage: z.literal("ARCHITECT"),
  components: z.array(z.object({ name: nonEmpty, responsibility: nonEmpty, boundary: nonEmpty })),
  contracts: z.array(z.object({ name: nonEmpty, kind: nonEmpty, shape: nonEmpty })),
  dataModel: z.array(z.object({ entity: nonEmpty, purpose: nonEmpty, ownership: nonEmpty })),
  security: z.object({ authorization: nonEmpty, tenancy: nonEmpty, secrets: nonEmpty }),
  observability: z.array(nonEmpty),
  failureHandling: z.array(nonEmpty),
  tasks: z.array(
    z.object({
      id: nonEmpty,
      description: nonEmpty,
      dependsOn: z.array(z.string()),
      parallelizable: z.boolean(),
    }),
  ).min(1),
});

/** The build package: what changed, and what the continuous checks said about it. */
export const buildPackage = z.object({
  version,
  stage: z.literal("BUILD"),
  changes: z.array(
    z.object({
      path: nonEmpty,
      kind: z.enum(["ADDED", "MODIFIED", "DELETED"]),
      summary: nonEmpty,
    }),
  ),
  migrations: z.array(z.object({ file: nonEmpty, summary: nonEmpty })),
  checks: z.array(z.object({ name: nonEmpty, status: checkStatus, detail: z.string() })),
});

/**
 * The review package.
 *
 * `CHANGES_REQUESTED` is distinct from `REJECT` because the two route
 * differently: one returns the work to BUILD, the other says the design was
 * wrong and belongs further back.
 */
export const reviewPackage = z.object({
  version,
  stage: z.literal("REVIEW"),
  verdict: z.enum(["PASS", "CHANGES_REQUESTED", "REJECT"]),
  findings: z.array(
    z.object({ title: nonEmpty, severity, location: nonEmpty, evidence: nonEmpty }),
  ),
  architectureCompliance: nonEmpty,
  licences: z.array(
    z.object({ dependency: nonEmpty, licence: nonEmpty, compatible: z.boolean() }),
  ),
});

/**
 * The test package.
 *
 * Counts, not adjectives. This is the stage whose claim must be anchored, and
 * `evidence[].source` is where the anchor points — a command that was run, a
 * report that exists — rather than a summary of one.
 */
export const testPackage = z.object({
  version,
  stage: z.literal("TEST"),
  suites: z.array(
    z.object({
      name: nonEmpty,
      kind: z.enum([
        "UNIT", "INTEGRATION", "API", "E2E", "REGRESSION", "SECURITY",
        "PERFORMANCE", "ACCESSIBILITY", "RESPONSIVE", "AUTHORIZATION", "DATA_INTEGRITY",
      ]),
      passed: z.number().int().min(0),
      failed: z.number().int().min(0),
      skipped: z.number().int().min(0),
      durationMs: z.number().int().min(0).nullable(),
    }),
  ),
  evidence: z.array(z.object({ label: nonEmpty, source: nonEmpty, detail: z.string() })).min(1),
  verdict: z.enum(["PASS", "FAIL"]),
});

/** The deployment package: what was checked before, what happened, and the way back. */
export const deploymentPackage = z.object({
  version,
  stage: z.literal("DEPLOY"),
  preflight: z.array(z.object({ name: nonEmpty, status: checkStatus, detail: z.string() })),
  target: nonEmpty,
  release: z.object({ id: z.string().nullable(), url: z.string().nullable() }),
  smokeTests: z.array(z.object({ name: nonEmpty, status: checkStatus })),
  rollback: z.object({ available: z.boolean(), how: nonEmpty }),
  verdict: z.enum(["DEPLOYED", "REFUSED", "ROLLED_BACK"]),
});

/**
 * The monitoring package, which is also the next requirement's input.
 *
 * `acceptanceMet` is nullable on purpose. "We do not yet know" is a real state
 * for a system that has been live for four minutes, and collapsing it into
 * `false` would manufacture a failure while collapsing it into `true` would
 * manufacture a success.
 */
export const monitoringPackage = z.object({
  version,
  stage: z.literal("MONITOR"),
  window: z.object({ from: nonEmpty, to: nonEmpty }),
  signals: z.array(
    z.object({ name: nonEmpty, value: z.number(), unit: nonEmpty, source: nonEmpty }),
  ),
  incidents: z.array(z.object({ title: nonEmpty, severity, detail: nonEmpty })),
  acceptanceMet: z.boolean().nullable(),
  followUps: z.array(nonEmpty),
});

export const STAGE_ARTIFACT_SCHEMAS: Readonly<Record<SdlcStage, z.ZodTypeAny>> = Object.freeze({
  REQUIREMENT: requirementPackage,
  DISCOVER: discoveryPackage,
  EVALUATE: evaluationPackage,
  DECIDE: decisionPackage,
  ARCHITECT: architecturePackage,
  BUILD: buildPackage,
  REVIEW: reviewPackage,
  TEST: testPackage,
  DEPLOY: deploymentPackage,
  MONITOR: monitoringPackage,
});

export function stageArtifactSchema(stage: SdlcStage): z.ZodTypeAny {
  return STAGE_ARTIFACT_SCHEMAS[stage];
}

/**
 * Does this payload satisfy the stage's contract?
 *
 * Returns the reasons rather than throwing, because the caller is usually
 * recording a handoff: an invalid package is a fact about the run to be written
 * down, not an exception to be raised at the engine.
 */
export function validateStageArtifact(
  stage: SdlcStage,
  payload: unknown,
): { readonly valid: boolean; readonly issues: readonly string[] } {
  const result = stageArtifactSchema(stage).safeParse(payload);
  if (result.success) return { valid: true, issues: [] };
  return {
    valid: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    ),
  };
}

/* c8 ignore next 4 -- a compile-time exhaustiveness check, not a branch. */
const MISSING = SDLC_STAGES.filter((stage) => !(stage in STAGE_ARTIFACT_SCHEMAS));
if (MISSING.length > 0) {
  throw new Error(`No artifact contract for lifecycle stage(s): ${MISSING.join(", ")}`);
}
