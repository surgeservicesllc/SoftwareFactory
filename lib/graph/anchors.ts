/**
 * Anchors: evidence that does not come from a model.
 *
 * The rule this module exists to enforce is short. **A worker saying "the tests
 * pass" is not evidence. The test result is.** An agent's claim about the world
 * is a hypothesis; an anchor is an observation of the world, produced by
 * something that cannot be persuaded — a test runner, a CI check, a deployment
 * API, an HTTP probe, a database query, a diff.
 *
 * SoftwareFactory already produces most of these. `lib/worker/validation.ts`
 * runs lint, typecheck, test and build in a pinned container; CI reports check
 * conclusions; the Vercel adapter reports deployment state; Phase 1E runs
 * synthetic journeys. What was missing is a way to attach those observations to
 * a graph decision, so a node's claim can be checked against them rather than
 * taken on trust.
 */

/** Kinds of non-AI evidence. Each names something observable, not asserted. */
export const ANCHOR_KINDS = [
  "test_run",
  "ci_check",
  "deployment_state",
  "http_health",
  "database_query",
  "synthetic_journey",
  "repository_diff",
  "security_scan",
  "production_error_signal",
] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

export type Anchor = {
  readonly kind: AnchorKind;
  /** What produced it — a workflow name, a container image, a URL, a query. */
  readonly source: string;
  /** ISO timestamp of the observation, not of the claim about it. */
  readonly observedAt: string;
  /** Did the observed thing succeed? Null when the anchor only reports state. */
  readonly passed: boolean | null;
  /** A pointer a human can follow: a run URL, a deployment id, a commit SHA. */
  readonly reference: string | null;
  readonly detail: string;
};

/**
 * Claims a node can make that require anchoring.
 *
 * The list is deliberately about *outcomes*, because those are the claims that
 * get believed and acted on. "I wrote a function" needs no anchor; "the tests
 * pass" absolutely does.
 */
export const ANCHORED_CLAIMS = [
  "TESTS_PASS",
  "BUILD_SUCCEEDS",
  "LINT_CLEAN",
  "TYPECHECK_CLEAN",
  "DEPLOYED",
  "SERVICE_HEALTHY",
  "MIGRATION_APPLIED",
  "NO_SECURITY_FINDINGS",
  "CHANGE_LANDED",
] as const;
export type AnchoredClaim = (typeof ANCHORED_CLAIMS)[number];

/**
 * Which anchor kinds can support which claim.
 *
 * Note what is absent: there is no entry that lets a model's own output support
 * any of these. That is the point — the mapping is from claim to *observation*,
 * and a claim with no acceptable observation cannot be anchored at all.
 */
export const CLAIM_ACCEPTABLE_ANCHORS: Readonly<Record<AnchoredClaim, readonly AnchorKind[]>> =
  Object.freeze({
    TESTS_PASS: ["test_run", "ci_check"],
    BUILD_SUCCEEDS: ["test_run", "ci_check"],
    LINT_CLEAN: ["test_run", "ci_check"],
    TYPECHECK_CLEAN: ["test_run", "ci_check"],
    DEPLOYED: ["deployment_state"],
    SERVICE_HEALTHY: ["http_health", "synthetic_journey", "production_error_signal"],
    MIGRATION_APPLIED: ["database_query"],
    NO_SECURITY_FINDINGS: ["security_scan"],
    CHANGE_LANDED: ["repository_diff", "ci_check"],
  });

export type AnchorCheck = {
  readonly anchored: boolean;
  readonly supporting: readonly Anchor[];
  readonly reason: string;
};

/**
 * Is this claim supported by real evidence?
 *
 * A claim is anchored only when an acceptable anchor exists **and that anchor
 * actually passed**. A failing test run is evidence too — evidence against —
 * and treating its mere existence as support is how "we ran the tests" becomes
 * "the tests pass".
 */
export function checkClaimAnchored(
  claim: AnchoredClaim,
  anchors: readonly Anchor[],
): AnchorCheck {
  const acceptable = CLAIM_ACCEPTABLE_ANCHORS[claim];
  const relevant = anchors.filter((anchor) => acceptable.includes(anchor.kind));

  if (relevant.length === 0) {
    return {
      anchored: false,
      supporting: [],
      reason:
        `No ${acceptable.join(" or ")} evidence was attached, so "${claim}" is an assertion rather than an observation.`,
    };
  }

  const failing = relevant.filter((anchor) => anchor.passed === false);
  if (failing.length > 0) {
    return {
      anchored: false,
      supporting: [],
      reason:
        `Evidence exists and contradicts the claim: ${failing
          .map((anchor) => `${anchor.kind} from ${anchor.source}`)
          .join(", ")} did not pass.`,
    };
  }

  const supporting = relevant.filter((anchor) => anchor.passed === true);
  if (supporting.length === 0) {
    return {
      anchored: false,
      supporting: [],
      reason:
        `Evidence exists but reports state rather than success, so it cannot support "${claim}".`,
    };
  }

  return {
    anchored: true,
    supporting,
    reason: `Supported by ${supporting.length} observation(s): ${supporting
      .map((anchor) => `${anchor.kind} from ${anchor.source}`)
      .join(", ")}.`,
  };
}

/**
 * Is this anchor recent enough to still mean anything?
 *
 * A green test run from before the last commit says nothing about the current
 * one. Staleness is the quiet way an anchor stops being evidence while still
 * looking like it.
 */
export function anchorIsFresh(
  anchor: Anchor,
  now: Date,
  maxAgeMs: number,
): boolean {
  const observed = Date.parse(anchor.observedAt);
  if (Number.isNaN(observed)) return false;
  return now.getTime() - observed <= maxAgeMs;
}

/**
 * Anchor a claim, requiring the evidence to be both supportive and fresh.
 *
 * Separate from `checkClaimAnchored` so a caller must decide what "recent"
 * means for its situation rather than inheriting a default that quietly makes
 * old evidence acceptable.
 */
export function checkClaimAnchoredFresh(
  claim: AnchoredClaim,
  anchors: readonly Anchor[],
  now: Date,
  maxAgeMs: number,
): AnchorCheck {
  const fresh = anchors.filter((anchor) => anchorIsFresh(anchor, now, maxAgeMs));
  const staleCount = anchors.length - fresh.length;
  const result = checkClaimAnchored(claim, fresh);

  if (result.anchored || staleCount === 0) return result;

  return {
    ...result,
    reason: `${result.reason} ${staleCount} anchor(s) were discarded as stale.`,
  };
}

/**
 * Turn a container validation result into an anchor.
 *
 * This is the seam to what already exists: `DeterministicValidator` runs the
 * real scripts in a pinned image, and its result is an observation rather than
 * a claim, so it converts directly.
 */
export function anchorFromValidation(input: {
  readonly script: string;
  readonly passed: boolean;
  readonly image: string;
  readonly observedAt: string;
  readonly detail?: string;
}): Anchor {
  return {
    kind: "test_run",
    source: `${input.script} in ${input.image}`,
    observedAt: input.observedAt,
    passed: input.passed,
    reference: null,
    detail: input.detail ?? `${input.script} ${input.passed ? "passed" : "failed"} in the pinned validation container.`,
  };
}

/** Turn an observed CI check conclusion into an anchor. */
export function anchorFromCheckRun(input: {
  readonly name: string;
  readonly conclusion: string;
  readonly url: string;
  readonly observedAt: string;
}): Anchor {
  return {
    kind: "ci_check",
    source: input.name,
    observedAt: input.observedAt,
    // Only an explicit success counts. Anything else — cancelled, skipped,
    // neutral, timed out — is not a pass, and must not read as one.
    passed: input.conclusion === "success",
    reference: input.url,
    detail: `CI check "${input.name}" concluded ${input.conclusion}.`,
  };
}
