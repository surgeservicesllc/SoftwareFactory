import type { NodeCapability } from "@/lib/graph/contracts";

/**
 * The Agentic SDLC.
 *
 * A graph could always be run. What it could not do is say *where in a software
 * lifecycle* a node sits, and so it could not hold one stage until the next was
 * allowed to begin. This module is that missing vocabulary, and it is
 * deliberately small: ten stages, the order they run in, the capability each
 * one needs, and the gate that guards it.
 *
 * ## Why ten and not eight
 *
 * The first version had eight, and folded four questions into two. `GOAL` and
 * `PRD` were both "what are we being asked for", and the split between them was
 * a document boundary rather than a decision boundary. Meanwhile the three
 * questions that actually decide how much work there is — *does this already
 * exist somewhere*, *which candidate is worth having*, and *do we use it, adapt
 * it, or build it* — had no stage at all, so they happened inside
 * `ARCHITECTURE` if they happened, unrecorded either way.
 *
 * Ten stages moves the boundaries to where the decisions are: one stage for the
 * request, three for the build-or-borrow question, and the rest unchanged in
 * everything but name.
 *
 * Everything here is data. No stage calls a provider, opens a connection, or
 * reads a clock — which is what lets the whole lifecycle be tested without a
 * credential.
 */

export const SDLC_STAGES = [
  "REQUIREMENT",
  "DISCOVER",
  "EVALUATE",
  "DECIDE",
  "ARCHITECT",
  "BUILD",
  "REVIEW",
  "TEST",
  "DEPLOY",
  "MONITOR",
] as const;
export type SdlcStage = (typeof SDLC_STAGES)[number];

/** How a stage's gate is decided. */
export const GATE_KINDS = ["AUTOMATIC", "HUMAN"] as const;
export type GateKind = (typeof GATE_KINDS)[number];

export const GATE_STATES = ["PENDING", "OPEN", "APPROVED", "REJECTED"] as const;
export type GateState = (typeof GATE_STATES)[number];

export type StageDefinition = {
  readonly stage: SdlcStage;
  /** 1 through 10, the number the navigation and every stage page shows. */
  readonly number: number;
  /** The stage's name in sentence case, for headings. */
  readonly title: string;
  /** The URL segment for this stage's landing page. */
  readonly slug: string;
  /**
   * What the stage is for, in one sentence a reader who has never used this
   * product can follow. The landing pages lead with this; the technical detail
   * sits behind it rather than in front of it.
   */
  readonly purpose: string;
  /** What the stage produces, in one line, for the console and the audit trail. */
  readonly produces: string;
  /** The name of the typed package this stage hands the next one. */
  readonly artifact: string;
  readonly capability: NodeCapability;
  /**
   * The gate that guards *leaving* this stage. `null` means the stage advances
   * on its own dependencies alone.
   *
   * The two human gates are not a default that was never revisited. ARCHITECT
   * is where a wrong decision is cheapest to reverse and most expensive to
   * discover later, and DEPLOY is an externally visible act — the class of
   * action this repository keeps owner-gated in Phase 1 whatever else changes.
   *
   * DECIDE is deliberately *not* a third human gate. It is consequential, but
   * its whole output is a choice between options EVALUATE already scored, and
   * an automatic gate that refuses a decision citing no evidence enforces more
   * than a human gate nobody is present to answer.
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
    stage: "REQUIREMENT",
    number: 1,
    title: "Requirement",
    slug: "requirement",
    purpose: "Turn what you asked for into something that can be checked rather than admired.",
    produces:
      "The objective, scope, constraints, acceptance criteria, assumptions and risks the request implies.",
    artifact: "requirement package",
    capability: "planning",
    gate: "AUTOMATIC",
    requiresAnchor: false,
  },
  {
    stage: "DISCOVER",
    number: 2,
    title: "Discover",
    slug: "discover",
    purpose: "Find what already exists — here, and in the wider world — before building anything.",
    produces:
      "Candidates from this repository, public packages, APIs and prior art, each with its source, licence, activity and relevance.",
    artifact: "discovery package",
    capability: "extraction",
    /*
     * Anchored, because every claim this stage makes is a claim about the world
     * outside this repository: that a package exists, that its licence is MIT,
     * that it was touched this year. Those are exactly the claims a model can
     * produce fluently and wrongly, and a lifecycle that accepted them on
     * assurance would be building on invention.
     */
    requiresAnchor: true,
    gate: null,
  },
  {
    stage: "EVALUATE",
    number: 3,
    title: "Evaluate",
    slug: "evaluate",
    purpose: "Score the candidates honestly, against the things that decide whether they survive contact with production.",
    produces:
      "A comparison across licence, security, maintenance, completeness, performance, documentation and integration effort, with the risks named.",
    artifact: "evaluation package",
    capability: "review",
    gate: "AUTOMATIC",
    requiresAnchor: false,
  },
  {
    stage: "DECIDE",
    number: 4,
    title: "Decide",
    slug: "decide",
    purpose: "Choose: use it, connect to it, adapt it, fork it, or build it.",
    produces:
      "The decision, the evidence behind it, the trade-offs accepted, and the integration boundary it commits to.",
    artifact: "decision package",
    capability: "architecture",
    gate: "AUTOMATIC",
    requiresAnchor: false,
  },
  {
    stage: "ARCHITECT",
    number: 5,
    title: "Architect",
    slug: "architect",
    purpose: "Design it: the parts, their boundaries, and how it fails.",
    produces:
      "System and component design, contracts, data model, security and secrets handling, observability, and the task graph the build follows.",
    artifact: "architecture package",
    capability: "architecture",
    gate: "HUMAN",
    requiresAnchor: false,
  },
  {
    stage: "BUILD",
    number: 6,
    title: "Build",
    slug: "build",
    purpose: "Write it — in parallel wherever the work genuinely does not overlap.",
    produces: "The change itself: code, migrations, interfaces, configuration and documentation.",
    artifact: "build package",
    capability: "implementation",
    gate: null,
    requiresAnchor: false,
  },
  {
    stage: "REVIEW",
    number: 7,
    title: "Review",
    slug: "review",
    purpose: "Have someone who never saw the reasoning read the result.",
    produces:
      "A review of the change against the architecture, its security, its dependencies and licences, and its error handling.",
    artifact: "review package",
    capability: "review",
    gate: "AUTOMATIC",
    requiresAnchor: false,
  },
  {
    stage: "TEST",
    number: 8,
    title: "Test",
    slug: "test",
    purpose: "Prove it works by running it, not by describing it.",
    produces: "Test, security, accessibility and responsive results, recorded as evidence.",
    artifact: "test package",
    capability: "qa",
    gate: "AUTOMATIC",
    requiresAnchor: true,
  },
  {
    stage: "DEPLOY",
    number: 9,
    title: "Deploy",
    slug: "deploy",
    purpose: "Ship it, with a way back.",
    produces: "The preflight results, the deployment decision, what it reported, and the rollback that stands ready.",
    artifact: "deployment package",
    capability: "implementation",
    gate: "HUMAN",
    requiresAnchor: true,
  },
  {
    stage: "MONITOR",
    number: 10,
    title: "Monitor",
    slug: "monitor",
    purpose: "Watch what the running system reports, and turn what it finds into the next request.",
    produces:
      "Health, errors, latency, usage and cost as observed, and whether the acceptance criteria were actually met.",
    artifact: "monitoring package",
    capability: "synthesis",
    gate: null,
    requiresAnchor: true,
  },
]);

const BY_STAGE: ReadonlyMap<SdlcStage, StageDefinition> = new Map(
  SDLC_LIFECYCLE.map((definition) => [definition.stage, definition]),
);

const BY_SLUG: ReadonlyMap<string, StageDefinition> = new Map(
  SDLC_LIFECYCLE.map((definition) => [definition.slug, definition]),
);

export function stageDefinition(stage: SdlcStage): StageDefinition {
  const definition = BY_STAGE.get(stage);
  /* c8 ignore next -- unreachable while SdlcStage and SDLC_LIFECYCLE agree. */
  if (!definition) throw new Error(`No definition for lifecycle stage ${stage}.`);
  return definition;
}

/**
 * The stage a URL segment names, or null.
 *
 * Returns null rather than throwing because the caller is a route handler
 * answering an arbitrary path, and an unknown segment is a 404 rather than a
 * fault in the server.
 */
export function stageFromSlug(slug: string): StageDefinition | null {
  return BY_SLUG.get(slug.trim().toLowerCase()) ?? null;
}

/** Is this string one of the ten stages? Narrows, so callers can stop casting. */
export function isSdlcStage(value: unknown): value is SdlcStage {
  return typeof value === "string" && BY_STAGE.has(value as SdlcStage);
}

export function stageIndex(stage: SdlcStage): number {
  return SDLC_STAGES.indexOf(stage);
}

/** The stage that follows, or null at the end of a pass. */
export function nextStage(stage: SdlcStage): SdlcStage | null {
  return SDLC_STAGES[stageIndex(stage) + 1] ?? null;
}

/** The stage before, or null at the start of a pass. */
export function previousStage(stage: SdlcStage): SdlcStage | null {
  const index = stageIndex(stage);
  return index <= 0 ? null : SDLC_STAGES[index - 1];
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
 * one was. Sending an architecture rejection back to BUILD would re-implement
 * the same wrong design; sending a bad evaluation back to DISCOVER is right,
 * because a comparison of the wrong candidates cannot be fixed by comparing
 * them again.
 */
export const REJECTION_RETURNS_TO: Readonly<Record<SdlcStage, SdlcStage>> = Object.freeze({
  REQUIREMENT: "REQUIREMENT",
  DISCOVER: "REQUIREMENT",
  EVALUATE: "DISCOVER",
  DECIDE: "EVALUATE",
  ARCHITECT: "DECIDE",
  BUILD: "ARCHITECT",
  REVIEW: "BUILD",
  TEST: "BUILD",
  DEPLOY: "TEST",
  MONITOR: "REQUIREMENT",
});

/**
 * The display status of a node, which is not the same as its database state.
 *
 * The database records nine execution states. What a reader wants to know is
 * narrower and includes one thing the state alone cannot say: a node that has
 * finished the DEPLOY stage is *deployed*, and calling that merely "passed"
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
      return input.stage === "DEPLOY" ? "deployed" : "passed";
    default:
      return "queued";
  }
}

/** Whether a status means the node still has work ahead of it. */
export function isTerminalStatus(status: NodeDisplayStatus): boolean {
  return status === "failed" || status === "passed" || status === "deployed" || status === "skipped";
}

/**
 * The states a *stage* can be in, which is not the same list a node uses.
 *
 * A stage is many nodes, so it has two states no single node has — `Waiting`,
 * for a stage whose own work is finished but whose successors cannot start, and
 * `Repairing`, for one a failure downstream has sent work back to.
 */
export const STAGE_STATUSES = [
  "Not Started",
  "Queued",
  "Running",
  "Waiting",
  "Reviewing",
  "Failed",
  "Repairing",
  "Passed",
  "Complete",
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export type StageRollupInput = {
  /** Every node in this stage, as the console displays them. */
  readonly statuses: readonly NodeDisplayStatus[];
  /** True when any gate in the stage was rejected and the work came back. */
  readonly repairing?: boolean;
  /** True when this is the last stage of the lifecycle and it finished. */
  readonly isFinalStage?: boolean;
};

/**
 * One stage's status, rolled up from its nodes.
 *
 * The precedence is the design and it is not alphabetical: a stage with one
 * failed node is failed however many others passed, and a stage with one node
 * still at a gate is reviewing however much else finished. Optimistic rollups
 * are how a dashboard ends up green over a broken run.
 */
export function stageStatus(input: StageRollupInput): StageStatus {
  const statuses = input.statuses;
  if (statuses.length === 0) return "Not Started";
  if (input.repairing) return "Repairing";
  if (statuses.includes("failed")) return "Failed";
  if (statuses.includes("review")) return "Reviewing";
  if (statuses.includes("running")) return "Running";
  if (statuses.includes("blocked")) return "Waiting";
  if (statuses.includes("queued")) return "Queued";
  // Everything terminal and nothing failed. The last stage of a lifecycle that
  // finished is Complete; an earlier one has only passed its own part.
  return input.isFinalStage ? "Complete" : "Passed";
}
