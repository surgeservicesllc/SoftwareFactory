/**
 * Independent verification.
 *
 * Two rules do most of the work here.
 *
 * **A worker never verifies itself.** Not the same agent, and — where the graph
 * asks for it — not the same provider, because two calls to one model share its
 * blind spots. The check is on identity, so it cannot be satisfied by a
 * differently-worded prompt to the same worker.
 *
 * **A verifier never sees the worker's context.** It receives the claim, the
 * evidence, the acceptance criteria, and the source material — and nothing of
 * how the claim was reached. A verifier shown the worker's reasoning tends to
 * check whether the reasoning is coherent rather than whether the claim is
 * true, which is the failure this whole layer exists to avoid.
 */

export const VERIFICATION_VERDICTS = ["PASS", "WARN", "REJECT", "BLOCK"] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

/** What a verifier is looking at. Different lenses catch different failures. */
export const VERIFICATION_LENSES = [
  "correctness",
  "freshness",
  "evidence",
  "security",
  "acceptance_criteria",
] as const;
export type VerificationLens = (typeof VERIFICATION_LENSES)[number];

export type VerifierIdentity = {
  readonly agentId: string;
  readonly provider: string;
};

export type Verification = {
  readonly verifier: VerifierIdentity;
  readonly lens: VerificationLens;
  readonly verdict: VerificationVerdict;
  /** Why. A verdict without evidence is an opinion. */
  readonly evidence: readonly string[];
};

export const QUORUM_STRATEGIES = [
  "SINGLE",
  "MAJORITY",
  "UNANIMOUS",
  "SPECIALIZED_LENSES",
] as const;
export type QuorumStrategy = (typeof QUORUM_STRATEGIES)[number];

export type QuorumPolicy = {
  readonly strategy: QuorumStrategy;
  /** Lenses that must be present for SPECIALIZED_LENSES. */
  readonly requiredLenses?: readonly VerificationLens[];
  /** WARN counts as a pass for ordinary findings when true. */
  readonly warnPasses?: boolean;
};

export type IndependenceViolation =
  | "VERIFIER_IS_IMPLEMENTER"
  | "VERIFIER_SHARES_PROVIDER"
  | "VERIFIER_SHARED_CONTEXT";

export type IndependenceCheck = {
  readonly independent: boolean;
  readonly violation: IndependenceViolation | null;
  readonly detail: string;
};

export type VerifierContext = {
  readonly verifier: VerifierIdentity;
  /** True when the verifier was handed the worker's conversation or scratchpad. */
  readonly sharedWorkerContext: boolean;
};

/**
 * Is this verifier independent of the worker?
 *
 * `requireDistinctProvider` is a property of the step, not a global: some
 * verifications genuinely need a different vendor's model, and some only need
 * a different agent with a clean context.
 */
export function checkIndependence(
  implementer: VerifierIdentity,
  context: VerifierContext,
  options: { readonly requireDistinctProvider?: boolean } = {},
): IndependenceCheck {
  if (context.verifier.agentId === implementer.agentId) {
    return {
      independent: false,
      violation: "VERIFIER_IS_IMPLEMENTER",
      detail: "An agent cannot verify its own work, whichever model executed it.",
    };
  }

  if (context.sharedWorkerContext) {
    return {
      independent: false,
      violation: "VERIFIER_SHARED_CONTEXT",
      detail:
        "The verifier was given the worker's context. It would be checking the reasoning's coherence, not the claim's truth.",
    };
  }

  if (options.requireDistinctProvider && context.verifier.provider === implementer.provider) {
    return {
      independent: false,
      violation: "VERIFIER_SHARES_PROVIDER",
      detail:
        "This step requires cross-provider verification, and both sides are on the same provider.",
    };
  }

  return { independent: true, violation: null, detail: "Verifier is independent." };
}

export type QuorumOutcome = {
  readonly verdict: VerificationVerdict;
  readonly satisfied: boolean;
  readonly reasons: readonly string[];
};

/**
 * Resolve a set of verifications into one verdict.
 *
 * The absolute rule, ahead of every strategy: **a security BLOCK blocks.** No
 * majority overrides it, because the entire point of a blocking security
 * finding is that it is not a vote.
 */
export function resolveQuorum(
  verifications: readonly Verification[],
  policy: QuorumPolicy,
): QuorumOutcome {
  const reasons: string[] = [];

  if (verifications.length === 0) {
    return {
      verdict: "REJECT",
      satisfied: false,
      reasons: ["No verification was performed, which is not the same as passing."],
    };
  }

  const securityBlock = verifications.find(
    (entry) => entry.lens === "security" && entry.verdict === "BLOCK",
  );
  if (securityBlock) {
    return {
      verdict: "BLOCK",
      satisfied: false,
      reasons: [
        `Security verifier ${securityBlock.verifier.agentId} returned BLOCK. A security block is absolute and no quorum overrides it.`,
      ],
    };
  }

  const anyBlock = verifications.find((entry) => entry.verdict === "BLOCK");
  if (anyBlock) {
    return {
      verdict: "BLOCK",
      satisfied: false,
      reasons: [`Verifier ${anyBlock.verifier.agentId} returned BLOCK on the ${anyBlock.lens} lens.`],
    };
  }

  const passes = verifications.filter(
    (entry) => entry.verdict === "PASS" || (policy.warnPasses && entry.verdict === "WARN"),
  );

  if (policy.strategy === "SPECIALIZED_LENSES") {
    const required = policy.requiredLenses ?? [];
    const present = new Set(verifications.map((entry) => entry.lens));
    const missing = required.filter((lens) => !present.has(lens));
    if (missing.length > 0) {
      return {
        verdict: "REJECT",
        satisfied: false,
        reasons: [`Missing required verification lens(es): ${missing.join(", ")}.`],
      };
    }
    // Everything that did not pass, not only what rejected.
    //
    // This branch used to look at REJECT alone, so a WARN returned PASS even
    // with `warnPasses: false` — every other strategy honours that flag, and
    // this is the strategy that carries the required security lens, so it was
    // the worst one to let a warning through. The reason string then said "all
    // required lenses passed", which was not true of the lens that warned.
    const failures = verifications.filter((entry) => !passes.includes(entry));
    if (failures.length > 0) {
      return {
        verdict: "REJECT",
        satisfied: false,
        reasons: failures.map(
          (entry) => `${entry.lens} verifier ${entry.verifier.agentId} returned ${entry.verdict}.`,
        ),
      };
    }
    // Surfaced as WARN rather than PASS when `warnPasses` admitted a warning,
    // matching MAJORITY. The step is satisfied either way; a caller that wants
    // to know a lens warned should not have to re-derive it from the evidence.
    const warned = passes.some((entry) => entry.verdict === "WARN");
    reasons.push(
      warned
        ? `All ${required.length} required lens(es) cleared, with at least one warning.`
        : `All ${required.length} required lens(es) passed.`,
    );
    return { verdict: warned ? "WARN" : "PASS", satisfied: true, reasons };
  }

  if (policy.strategy === "UNANIMOUS") {
    if (passes.length === verifications.length) {
      return {
        verdict: "PASS",
        satisfied: true,
        reasons: [`All ${verifications.length} verifiers passed.`],
      };
    }
    return {
      verdict: "REJECT",
      satisfied: false,
      reasons: [`Unanimity required; ${verifications.length - passes.length} verifier(s) did not pass.`],
    };
  }

  if (policy.strategy === "MAJORITY") {
    const needed = Math.floor(verifications.length / 2) + 1;
    if (passes.length >= needed) {
      return {
        verdict: passes.some((entry) => entry.verdict === "WARN") ? "WARN" : "PASS",
        satisfied: true,
        reasons: [`${passes.length} of ${verifications.length} verifiers passed (needed ${needed}).`],
      };
    }
    return {
      verdict: "REJECT",
      satisfied: false,
      reasons: [`Only ${passes.length} of ${verifications.length} verifiers passed; ${needed} needed.`],
    };
  }

  // SINGLE
  const first = verifications[0];
  const satisfied = first.verdict === "PASS" || (Boolean(policy.warnPasses) && first.verdict === "WARN");
  return {
    verdict: first.verdict,
    satisfied,
    reasons: [`Single verifier ${first.verifier.agentId} returned ${first.verdict}.`],
  };
}
