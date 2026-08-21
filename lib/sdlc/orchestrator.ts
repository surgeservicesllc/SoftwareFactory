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

  for (const node of state.nodes) {
    if (node.stage === null) continue;
    const definition = stageDefinition(node.stage);

    if (definition.requiresAnchor) {
      const anchors = node.gate?.anchorCount ?? 0;
      if (anchors === 0) {
        unmet.push(
          `${node.stage} requires anchored evidence and ${node.nodeKey} has none, so its claim is unverified.`,
        );
      } else if (node.status === "passed" || node.status === "deployed") {
        satisfied.push({ stage: node.stage, anchorCount: anchors });
      }
    } else if (node.status === "passed" || node.status === "deployed") {
      satisfied.push({ stage: node.stage, anchorCount: node.gate?.anchorCount ?? 0 });
    }

    if (definition.gate !== null) {
      const gateState = node.gate?.state ?? null;
      if (gateState === null) {
        unmet.push(`${node.stage} has a ${definition.gate.toLowerCase()} gate that was never opened.`);
      } else if (gateState === "OPEN" || gateState === "PENDING") {
        unmet.push(`${node.stage} is waiting at its gate.`);
      } else if (gateState === "REJECTED") {
        unmet.push(`${node.stage} was rejected at its gate.`);
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
