import type { NodeCapability } from "@/lib/graph/contracts";

/**
 * The Agentic SDLC.
 *
 * A graph could always be run. What it could not do is say *where in a software
 * lifecycle* a node sits, and so it could not hold one stage until the next was
 * allowed to begin. This module is that missing vocabulary, and it is
 * deliberately small: the stages, the order they run in, the capability each
 * one needs, and the gate that guards it.
 *
 * Eleven stages, not eight, since 2026-08-23. DISCOVERY, EVALUATION and
 * DECISION sit between the requirement and the architecture — look before you
 * build — and they were deliberately withheld until something could produce
 * them (ADR-136: "the prerequisite is a capability that produces them, not an
 * enum value"). The `discovery`, `evaluation` and `decision` capabilities and
 * the `open_source_scout` template are that something, so the enum grows
 * exactly as that ADR said it should: additively, with the database migration
 * using `add value if not exists`. The owner's ten-stage presentation maps on
 * unchanged — REQUIREMENT is still GOAL + PRD, and the other nine are now one
 * to one.
 *
 * Everything here is data. No stage calls a provider, opens a connection, or
 * reads a clock — which is what lets the whole lifecycle be tested without a
 * credential.
 */

export const SDLC_STAGES = [
  "GOAL",
  "PRD",
  "DISCOVERY",
  "EVALUATION",
  "DECISION",
  "ARCHITECTURE",
  "IMPLEMENTATION",
  "REVIEW",
  "TEST",
  "DEPLOYMENT",
  "MONITORING",
] as const;
export type SdlcStage = (typeof SDLC_STAGES)[number];

/** How a stage's gate is decided. */
export const GATE_KINDS = ["AUTOMATIC", "HUMAN"] as const;
export type GateKind = (typeof GATE_KINDS)[number];

export const GATE_STATES = ["PENDING", "OPEN", "APPROVED", "REJECTED"] as const;
export type GateState = (typeof GATE_STATES)[number];

export type StageDefinition = {
  readonly stage: SdlcStage;
  /** What the stage produces, in one line, for the console and the audit trail. */
  readonly produces: string;
  readonly capability: NodeCapability;
  /**
   * The gate that guards *leaving* this stage. `null` means the stage advances
   * on its own dependencies alone.
   *
   * The two human gates are not a default that was never revisited. ARCHITECTURE
   * is where a wrong decision is cheapest to reverse and most expensive to
   * discover later, and DEPLOYMENT is an externally visible act — the class of
   * action this repository keeps owner-gated in Phase 1 whatever else changes.
   */
  readonly gate: GateKind | null;
  /**
   * Whether the stage's claim must be backed by an anchor — an observation made
   * by something that cannot be persuaded. A stage marked here may not be
   * called complete because a model said it was.
   */
  readonly requiresAnchor: boolean;
};

export const SDLC_LIFECYCLE: readonly StageDefinition[] = Object.freeze([
  {
    stage: "GOAL",
    produces: "The goal, stated as acceptance criteria that can be checked rather than admired.",
    capability: "planning",
    gate: null,
    requiresAnchor: false,
  },
  {
    stage: "PRD",
    produces: "A product requirements document: scope, non-goals, and the behaviour each criterion implies.",
    capability: "planning",
    gate: "AUTOMATIC",
    requiresAnchor: false,
  },
  {
    stage: "DISCOVERY",
    produces: "What already exists that could serve: internal code, installed dependencies, and known ecosystem candidates — each labelled with how it is actually known.",
    capability: "discovery",
    gate: null,
    requiresAnchor: false,
  },
  {
    stage: "EVALUATION",
    produces: "Every surviving candidate scored on one fixed rubric, ranked, with the top candidate examined and the red flags named.",
    capability: "evaluation",
    gate: null,
    requiresAnchor: false,
  },
  {
    stage: "DECISION",
    produces: "USE, CONNECT, ADAPT, FORK or BUILD — all five weighed, one chosen, with the rationale, boundaries and execution plan recorded.",
    capability: "decision",
    gate: "AUTOMATIC",
    requiresAnchor: false,
  },
  {
    stage: "ARCHITECTURE",
    produces: "The design: the components, their boundaries, and the decisions a reviewer would want recorded.",
    capability: "architecture",
    gate: "HUMAN",
    requiresAnchor: false,
  },
  {
    stage: "IMPLEMENTATION",
    produces: "The change itself, in the files the architecture named.",
    capability: "implementation",
    gate: null,
    requiresAnchor: false,
  },
  {
    stage: "REVIEW",
    produces: "A review of the change by a reader who never saw the implementation reasoning.",
    capability: "review",
    gate: "AUTOMATIC",
    requiresAnchor: false,
  },
  {
    stage: "TEST",
    produces: "Test and evaluation results, recorded as evidence rather than described.",
    capability: "qa",
    gate: "AUTOMATIC",
    requiresAnchor: true,
  },
  {
    stage: "DEPLOYMENT",
    produces: "The deployment decision and its outcome.",
    capability: "implementation",
    gate: "HUMAN",
    requiresAnchor: true,
  },
  {
    stage: "MONITORING",
    produces: "What the running system reports back, and whether it met the goal.",
    capability: "synthesis",
    gate: null,
    requiresAnchor: true,
  },
]);

const BY_STAGE: ReadonlyMap<SdlcStage, StageDefinition> = new Map(
  SDLC_LIFECYCLE.map((definition) => [definition.stage, definition]),
);

export function stageDefinition(stage: SdlcStage): StageDefinition {
  const definition = BY_STAGE.get(stage);
  /* c8 ignore next -- unreachable while SdlcStage and SDLC_LIFECYCLE agree. */
  if (!definition) throw new Error(`No definition for lifecycle stage ${stage}.`);
  return definition;
}

export function stageIndex(stage: SdlcStage): number {
  return SDLC_STAGES.indexOf(stage);
}

/** The stage that follows, or null at the end of a pass. */
export function nextStage(stage: SdlcStage): SdlcStage | null {
  return SDLC_STAGES[stageIndex(stage) + 1] ?? null;
}

/**
 * Is this edge a feedback edge — one that points back to an earlier stage?
 *
 * Asked structurally rather than declared, so a plan cannot label a forward
 * edge as feedback to smuggle it past the compiler's cycle check.
 */
export function isFeedbackTransition(from: SdlcStage, to: SdlcStage): boolean {
  return stageIndex(to) <= stageIndex(from);
}

/**
 * Which stages a rejected gate sends the work back to.
 *
 * A rejection is information about where the mistake was made, not just that
 * one was. Sending an architecture rejection back to IMPLEMENTATION would
 * re-implement the same wrong design.
 */
export const REJECTION_RETURNS_TO: Readonly<Record<SdlcStage, SdlcStage>> = Object.freeze({
  GOAL: "GOAL",
  PRD: "GOAL",
  // A rejected discovery means the requirement did not say what to look for;
  // a rejected evaluation means the candidates were wrong, not the scores;
  // a rejected decision means the comparison it rests on was not trusted.
  DISCOVERY: "PRD",
  EVALUATION: "DISCOVERY",
  DECISION: "EVALUATION",
  // Deliberately still PRD, not DECISION: every graph with an ARCHITECTURE
  // stage has a PRD upstream of it, and only some have a DECISION. A return
  // target that exists in every graph beats a truer-sounding one that may
  // not.
  ARCHITECTURE: "PRD",
  IMPLEMENTATION: "ARCHITECTURE",
  REVIEW: "IMPLEMENTATION",
  TEST: "IMPLEMENTATION",
  DEPLOYMENT: "TEST",
  MONITORING: "GOAL",
});

/**
 * The display status of a node, which is not the same as its database state.
 *
 * The database records nine execution states. What a reader wants to know is
 * narrower and includes one thing the state alone cannot say: a node that has
 * finished the DEPLOYMENT stage is *deployed*, and calling that merely "passed"
 * loses the fact that something changed outside this system.
 */
export const NODE_DISPLAY_STATUSES = [
  "queued",
  "running",
  "blocked",
  "review",
  "failed",
  "passed",
  "deployed",
  "skipped",
] as const;
export type NodeDisplayStatus = (typeof NODE_DISPLAY_STATUSES)[number];

export type NodeStatusInput = {
  readonly state: string;
  readonly stage?: SdlcStage | null;
  /** True when a gate on this node is open and undecided. */
  readonly gateOpen?: boolean;
};

export function nodeDisplayStatus(input: NodeStatusInput): NodeDisplayStatus {
  // An open gate outranks the execution state on purpose. A node whose work is
  // done but whose gate no one has decided is waiting on a person, and calling
  // it "passed" would be the single most misleading label on the board.
  if (input.gateOpen) return "review";

  switch (input.state) {
    case "PENDING":
    case "READY":
      return "queued";
    case "RUNNING":
      return "running";
    case "VERIFYING":
      return "review";
    case "BLOCKED":
      return "blocked";
    case "FAILED":
    case "CANCELLED":
      return "failed";
    case "SKIPPED":
      return "skipped";
    case "COMPLETED":
      return input.stage === "DEPLOYMENT" ? "deployed" : "passed";
    default:
      return "queued";
  }
}

/** Whether a status means the node still has work ahead of it. */
export function isTerminalStatus(status: NodeDisplayStatus): boolean {
  return status === "failed" || status === "passed" || status === "deployed" || status === "skipped";
}
