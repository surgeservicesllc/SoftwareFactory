import type { NodeContract } from "@/lib/graph/contracts";
import { validateHandoffInput } from "@/lib/graph/contracts";

/**
 * Structured handoffs.
 *
 * Agents exchange durable artifacts, not chat history. That distinction is the
 * whole point: a node receiving a handoff gets a typed payload plus the
 * decisions, assumptions, and blockers that shaped it — never the transcript
 * that produced them. Replaying a conversation is how context grows without
 * bound and how a downstream agent inherits an upstream one's mistaken
 * certainty.
 *
 * Validation happens on **arrival**, against the receiving node's input
 * contract, and an invalid handoff is stored rather than dropped. A handoff
 * that failed validation is evidence about why a node is blocked, and deleting
 * it would leave the graph unable to explain itself.
 */

export type HandoffDraft = {
  readonly fromNodeKey: string | null;
  readonly toNodeKey: string;
  readonly payload: unknown;
  /** Choices the producing node made that the consumer should not re-litigate. */
  readonly decisions?: readonly string[];
  /** What the producer took as given. Wrong assumptions surface here first. */
  readonly assumptions?: readonly string[];
  readonly blockers?: readonly string[];
  readonly nextAction?: string;
};

export type PreparedHandoff = {
  readonly fromNodeKey: string | null;
  readonly toNodeKey: string;
  readonly contractValid: boolean;
  readonly validationIssues: readonly string[];
  readonly payload: unknown;
  readonly decisions: readonly string[];
  readonly assumptions: readonly string[];
  readonly blockers: readonly string[];
  readonly nextAction: string | null;
};

/**
 * Validate a handoff against the receiving contract and shape it for storage.
 *
 * Never throws. A rejected handoff is a fact about the run, and the caller
 * decides whether that means retry, block, or fail.
 */
export function prepareHandoff(
  receiving: NodeContract,
  draft: HandoffDraft,
): PreparedHandoff {
  const outcome = validateHandoffInput(receiving, draft.payload);

  return {
    fromNodeKey: draft.fromNodeKey,
    toNodeKey: draft.toNodeKey,
    contractValid: outcome.valid,
    validationIssues: outcome.valid ? [] : outcome.issues,
    payload: draft.payload,
    decisions: draft.decisions ?? [],
    assumptions: draft.assumptions ?? [],
    blockers: draft.blockers ?? [],
    nextAction: draft.nextAction ?? null,
  };
}

/**
 * Assemble the context a node is allowed to see.
 *
 * Deliberately narrow. A node gets its own job, its inputs, and the decisions
 * and assumptions behind them — not the graph's whole history. §26 calls this
 * out directly: passing structured results between nodes must not require
 * replaying prior chats.
 */
export type NodeContext = {
  readonly job: string;
  readonly inputs: readonly { readonly fromNodeKey: string | null; readonly payload: unknown }[];
  readonly inheritedDecisions: readonly string[];
  readonly inheritedAssumptions: readonly string[];
  readonly unresolvedBlockers: readonly string[];
  /** True when at least one incoming handoff failed its contract. */
  readonly hasInvalidInput: boolean;
};

export function buildNodeContext(
  receiving: NodeContract,
  incoming: readonly PreparedHandoff[],
): NodeContext {
  const valid = incoming.filter((handoff) => handoff.contractValid);

  return {
    job: receiving.job,
    inputs: valid.map((handoff) => ({
      fromNodeKey: handoff.fromNodeKey,
      payload: handoff.payload,
    })),
    // Assumptions travel because an unexamined one upstream becomes a defect
    // downstream, and the consumer is often the first place it is visible.
    inheritedDecisions: valid.flatMap((handoff) => handoff.decisions),
    inheritedAssumptions: valid.flatMap((handoff) => handoff.assumptions),
    unresolvedBlockers: incoming.flatMap((handoff) => handoff.blockers),
    hasInvalidInput: incoming.some((handoff) => !handoff.contractValid),
  };
}

/**
 * What a **verifier** may see (§7).
 *
 * Separate from `buildNodeContext` on purpose, and narrower: the claim, the
 * evidence, the acceptance criteria, and the source material. No decisions, no
 * assumptions, no reasoning. A verifier shown how a conclusion was reached
 * tends to check whether the reasoning hangs together rather than whether the
 * claim is true, which defeats the point of verifying at all.
 */
export type VerifierContext = {
  readonly claim: unknown;
  readonly evidence: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly sourceMaterial: readonly string[];
  readonly instructions: string;
};

export function buildVerifierContext(input: {
  readonly claim: unknown;
  readonly evidence?: readonly string[];
  readonly acceptanceCriteria?: readonly string[];
  readonly sourceMaterial?: readonly string[];
  readonly instructions: string;
}): VerifierContext {
  return {
    claim: input.claim,
    evidence: input.evidence ?? [],
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    sourceMaterial: input.sourceMaterial ?? [],
    instructions: input.instructions,
  };
}

/**
 * Guard against leaking worker reasoning into a verifier's context.
 *
 * `buildVerifierContext` cannot carry decisions or assumptions by construction,
 * but a caller could still paste them into `sourceMaterial` or `instructions`.
 * This catches that, because "the verifier had a clean context" is a claim the
 * system should be able to check rather than assume.
 */
export function verifierContextIsClean(
  context: VerifierContext,
  workerContext: NodeContext,
): boolean {
  const leaked = [...workerContext.inheritedDecisions, ...workerContext.inheritedAssumptions];
  if (leaked.length === 0) return true;

  const haystack = [...context.sourceMaterial, context.instructions].join("\n");
  return !leaked.some((entry) => entry.trim().length > 0 && haystack.includes(entry));
}
