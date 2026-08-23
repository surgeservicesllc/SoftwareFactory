import {
  REJECTION_RETURNS_TO,
  stageDefinition,
  type GateKind,
  type GateState,
  type NodeDisplayStatus,
  type SdlcStage,
} from "@/lib/sdlc/lifecycle";

/**
 * The orchestrator.
 *
 * Not a second scheduler and not a second executor. The scheduler decides which
 * nodes are ready; the executor dispatches them and writes the results down.
 * This decides what the *lifecycle* should do next given everything that has
 * been written down — advance, wait for a person, repair, iterate, stop — and
 * it is a pure function of that state so the decision can be tested, replayed,
 * and disagreed with.
 *
 * ## The rule it exists to enforce
 *
 * **A lifecycle is not done because its nodes finished.** Every stage that this
 * repository marks as requiring an anchor must have one: an observation made by
 * something that cannot be persuaded. A run whose TEST stage completed on a
 * model's assurance that the tests pass is not a run that may be called
 * complete, and `acceptanceReport` is where that is decided rather than assumed.
 */

export type OrchestratorNode = {
  readonly nodeKey: string;
  readonly stage: SdlcStage | null;
  readonly status: NodeDisplayStatus;
  /**
   * Observations recorded for this node by something that cannot be persuaded.
   *
   * Deliberately *not* read off the gate. Anchors are evidence about the work;
   * a gate is a decision about it, and the two do not always coexist — MONITOR
   * requires anchored evidence and has no gate at all, so a run whose anchors
   * were counted through its gates could never satisfy that stage however much
   * evidence it produced. Optional so a caller that has not measured it says
   * so rather than asserting zero.
   */
  readonly anchorCount?: number;
  readonly gate: {
    readonly id: string;
    readonly kind: GateKind;
    readonly state: GateState;
    readonly anchorCount: number;
  } | null;
};

export type OrchestratorState = {
  readonly nodes: readonly OrchestratorNode[];
  readonly iteration: number;
  readonly maxIterations: number;
  /** False for the audit and build templates, which have no lifecycle at all. */
  readonly isLifecycle: boolean;
};

export const ORCHESTRATOR_ACTIONS = [
  "ADVANCE",
  "AWAIT_HUMAN_GATE",
  "DECIDE_AUTOMATIC_GATE",
  "REPAIR",
  "ITERATE",
  "COMPLETE",
  "EXHAUSTED",
  "HALTED",
] as const;
export type OrchestratorAction = (typeof ORCHESTRATOR_ACTIONS)[number];

export type RepairTarget = {
  readonly nodeKey: string;
  readonly stage: SdlcStage;
  /** The stage the work returns to, which is rarely the one that failed. */
  readonly returnsTo: SdlcStage;
  readonly why: string;
};

export type OrchestratorDecision = {
  readonly action: OrchestratorAction;
  readonly detail: string;
  /** Gates that need a decision before anything else can happen. */
  readonly awaitingGates: readonly { id: string; stage: SdlcStage | null; kind: GateKind }[];
  readonly repairs: readonly RepairTarget[];
  readonly acceptance: AcceptanceReport;
};

export type AcceptanceReport = {
  readonly met: boolean;
  /** Stages that finished, with the evidence backing each. */
  readonly satisfied: readonly { stage: SdlcStage; anchorCount: number }[];
  /** Why acceptance is not met, one sentence per reason. */
  readonly unmet: readonly string[];
};

/** Anchors recorded for a node, from wherever the caller could measure them. */
function anchorsOn(node: OrchestratorNode): number {
  return node.anchorCount ?? node.gate?.anchorCount ?? 0;
}

/**
 * Has this run earned the right to be called complete?
 *
 * Three questions, in the order that matters. Did every node reach a terminal
 * state? Did every stage that requires evidence produce some? Was every gate
 * decided, and decided in the affirmative?
 *
 * A "yes" to the first alone is what "the code was generated" looks like from
 * the outside, which is exactly why it is not sufficient here.
 */
export function acceptanceReport(state: OrchestratorState): AcceptanceReport {
  const unmet: string[] = [];
  const satisfied: { stage: SdlcStage; anchorCount: number }[] = [];

  const unfinished = state.nodes.filter(
    (node) => node.status !== "passed" && node.status !== "deployed" && node.status !== "skipped",
  );
  for (const node of unfinished) {
    unmet.push(`${node.nodeKey} is ${node.status}.`);
  }

  /*
   * Evidence is asked for per *stage*, not per node.
   *
   * A stage is a fan-out: DISCOVER asks three independent questions and then
   * reduces the answers, and the reducing node observes nothing itself. Demand
   * an anchor from every node and that reducer fails a rule it structurally
   * cannot satisfy, so the only staged lifecycle that could ever be accepted
   * would be one with no parallelism in an anchored stage — which is the shape
   * this engine exists to avoid.
   *
   * What the rule actually means is "this stage's claim rests on something
   * observed", and that is a question about the stage.
   */
  const stages = new Map<SdlcStage, OrchestratorNode[]>();
  for (const node of state.nodes) {
    if (node.stage === null) continue;
    const group = stages.get(node.stage);
    if (group) group.push(node);
    else stages.set(node.stage, [node]);
  }

  for (const [stage, nodes] of stages) {
    const definition = stageDefinition(stage);
    const anchors = nodes.reduce((total, node) => total + anchorsOn(node), 0);
    const finished = nodes.every(
      (node) => node.status === "passed" || node.status === "deployed" || node.status === "skipped",
    );

    if (definition.requiresAnchor && anchors === 0) {
      unmet.push(
        `${stage} requires anchored evidence and none of its ${nodes.length} node(s) recorded any, `
        + "so its claim is unverified.",
      );
    } else if (finished) {
      satisfied.push({ stage, anchorCount: anchors });
    }

    /*
     * The gate is a stage question for the same reason the anchor is.
     *
     * A template puts a stage's gate on the node that concludes it, not on
     * every node in it: REVIEW gates `review` and lets `security_review` run
     * beside it. Asked per node, `security_review` fails a check for a gate it
     * was never meant to carry — which made acceptance unreachable for every
     * shipped lifecycle, silently, because "not met" is also what an
     * in-progress run looks like.
     *
     * So: the stage needs at least one gate, and every gate it does carry has
     * to have been decided affirmatively.
     */
    const gates = nodes.map((node) => node.gate).filter((gate) => gate !== null);

    if (definition.gate !== null && gates.length === 0) {
      unmet.push(`${stage} has a ${definition.gate.toLowerCase()} gate that was never opened.`);
    }
    for (const gate of gates) {
      if (gate.state === "OPEN" || gate.state === "PENDING") {
        unmet.push(`${stage} is waiting at its gate.`);
      } else if (gate.state === "REJECTED") {
        unmet.push(`${stage} was rejected at its gate.`);
      }
    }
  }

  return { met: unmet.length === 0, satisfied, unmet };
}

/**
 * Where a failure sends the work.
 *
 * A rejection is information about *where* the mistake was made, not merely
 * that one was. Sending an architecture rejection back to implementation would
 * re-implement the same wrong design at full price, which is the specific
 * failure the return table exists to prevent.
 */
export function repairTargets(state: OrchestratorState): readonly RepairTarget[] {
  const targets: RepairTarget[] = [];
  for (const node of state.nodes) {
    if (node.stage === null) continue;

    if (node.gate?.state === "REJECTED") {
      targets.push({
        nodeKey: node.nodeKey,
        stage: node.stage,
        returnsTo: REJECTION_RETURNS_TO[node.stage],
        why: `${node.stage} was rejected at its gate.`,
      });
      continue;
    }
    if (node.status === "failed") {
      targets.push({
        nodeKey: node.nodeKey,
        stage: node.stage,
        returnsTo: REJECTION_RETURNS_TO[node.stage],
        why: `${node.nodeKey} failed.`,
      });
      continue;
    }
    if (node.status === "blocked" && stageDefinition(node.stage).requiresAnchor) {
      targets.push({
        nodeKey: node.nodeKey,
        stage: node.stage,
        returnsTo: node.stage,
        why: `${node.stage} is blocked for want of anchored evidence, which no retry of the node will supply.`,
      });
    }
  }
  return targets;
}

/**
 * Decide the next move.
 *
 * The order of these checks is the design. Gates outrank everything, because a
 * lifecycle that keeps working while a person is being asked to approve
 * something has not really asked. Repairs outrank iteration, because iterating
 * past an unrepaired failure just reproduces it. And the iteration cap outranks
 * optimism: a loop that has spent its budget stops and says so.
 */
export function decideNextAction(state: OrchestratorState): OrchestratorDecision {
  const acceptance = acceptanceReport(state);
  const repairs = repairTargets(state);

  const openGates = state.nodes
    .filter((node) => node.gate?.state === "OPEN")
    .map((node) => ({ id: node.gate!.id, stage: node.stage, kind: node.gate!.kind }));

  const humanGates = openGates.filter((gate) => gate.kind === "HUMAN");
  const automaticGates = openGates.filter((gate) => gate.kind === "AUTOMATIC");

  if (humanGates.length > 0) {
    return {
      action: "AWAIT_HUMAN_GATE",
      detail:
        humanGates.length === 1
          ? `${humanGates[0].stage} is waiting on an owner or admin decision.`
          : `${humanGates.length} stages are waiting on an owner or admin decision.`,
      awaitingGates: humanGates,
      repairs,
      acceptance,
    };
  }

  if (automaticGates.length > 0) {
    return {
      action: "DECIDE_AUTOMATIC_GATE",
      detail: `${automaticGates.length} automatic gate(s) can be decided against the evidence recorded.`,
      awaitingGates: automaticGates,
      repairs,
      acceptance,
    };
  }

  if (repairs.length > 0) {
    return {
      action: "REPAIR",
      detail: repairs
        .map((target) => `${target.why} Returns to ${target.returnsTo}.`)
        .join(" "),
      awaitingGates: [],
      repairs,
      acceptance,
    };
  }

  if (acceptance.met) {
    return {
      action: "COMPLETE",
      detail: `Every stage finished and every stage that needs evidence has it (${acceptance.satisfied.length} recorded).`,
      awaitingGates: [],
      repairs,
      acceptance,
    };
  }

  const runnable = state.nodes.some(
    (node) => node.status === "queued" || node.status === "running",
  );
  if (runnable) {
    return {
      action: "ADVANCE",
      detail: "There is ready work; run another pass.",
      awaitingGates: [],
      repairs,
      acceptance,
    };
  }

  if (!state.isLifecycle) {
    return {
      action: "HALTED",
      detail: "Nothing can start and this graph has no lifecycle to iterate.",
      awaitingGates: [],
      repairs,
      acceptance,
    };
  }

  if (state.iteration >= state.maxIterations) {
    return {
      action: "EXHAUSTED",
      detail:
        `The lifecycle spent all ${state.maxIterations} iterations without meeting its acceptance criteria: `
        + acceptance.unmet.join(" "),
      awaitingGates: [],
      repairs,
      acceptance,
    };
  }

  return {
    action: "ITERATE",
    detail:
      `Iteration ${state.iteration} of ${state.maxIterations} ended without acceptance: `
      + acceptance.unmet.join(" "),
    awaitingGates: [],
    repairs,
    acceptance,
  };
}
