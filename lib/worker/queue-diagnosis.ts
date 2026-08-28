/**
 * Why the queue answered empty.
 *
 * "No planned graph was claimable; nothing ran" is truthful and useless: it
 * cost a whole dispatch to learn nothing about WHICH filter excluded the graph
 * someone is watching. The versioned database projection evaluates the exact
 * active repository binding, required-check policy, and post-ARCH bridge
 * predicates. This formatter adds owner approval, run history, retirement,
 * executor support, and lifecycle gate-reopen explanations over those rows.
 *
 * It is a diagnosis, not an authority: the database function still decides
 * every claim. If this listing says a graph looks claimable while the claim
 * returned empty, that contradiction is itself the finding, and the line says
 * so. Output carries ids, states, counts and executor names only — never goal
 * text, never a credential.
 */

export type QueueGraphRow = Readonly<{
  id: string;
  requires_owner_approval: boolean;
  is_lifecycle: boolean;
  created_at: string;
  repository_scope_matches: boolean;
  required_check_policy_matches: boolean;
  phase1c_resume_ready: boolean;
  graph_nodes: ReadonlyArray<Readonly<{ executor: string }>>;
  graph_runs: ReadonlyArray<Readonly<{ state: string; completed_at: string | null }>>;
  graph_gates: ReadonlyArray<Readonly<{ state: string; opened_at: string; decided_at: string | null }>>;
}>;

const LIVE_RUN_STATES = new Set(["FAILED", "CANCELLED"]);

function excludingReason(graph: QueueGraphRow, supported: ReadonlySet<string>): string {
  if (!graph.repository_scope_matches) {
    return "does not have this worker's exact active primary repository binding";
  }
  if (!graph.required_check_policy_matches) {
    return "its persisted required-check policy differs from this worker's exact policy";
  }
  if (!graph.phase1c_resume_ready) {
    return "waiting for the latest completed predecessor's exact Phase 1C pull-request bridge evidence";
  }
  if (graph.requires_owner_approval) {
    return "requires owner approval before any worker may claim it";
  }

  const unsupported = [...new Set(
    graph.graph_nodes.map((node) => node.executor).filter((executor) => !supported.has(executor)),
  )];
  if (unsupported.length > 0) {
    return `needs executor(s) this worker does not declare: ${unsupported.join(", ")}`;
  }

  const failed = graph.graph_runs.filter((run) => run.state === "FAILED").length;
  if (failed >= 3) return `retired: ${failed} failed runs (limit 3)`;
  if (graph.graph_runs.length >= 10) return `retired: ${graph.graph_runs.length} runs (limit 10)`;

  const liveRuns = graph.graph_runs.filter((run) => !LIVE_RUN_STATES.has(run.state));
  if (liveRuns.length > 0) {
    const states = [...new Set(liveRuns.map((run) => run.state))].join(", ");
    if (!graph.is_lifecycle) {
      return `already answered: has run(s) in state ${states}`;
    }
    // The lifecycle exception: a halted run reopens when a gate approval is
    // newer than the last ANSWERING run's completion — the question was
    // answered. FAILED and CANCELLED runs answered nothing, so they do not
    // stale an approval (mirrors claim_planned_graph, 20260825000100).
    const running = liveRuns.some((run) => run.state === "RUNNING");
    if (running) return "a run is in flight (RUNNING)";
    const lastCompleted = graph.graph_runs
      .filter((run) => !LIVE_RUN_STATES.has(run.state))
      .map((run) => run.completed_at)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1);
    const reopening = graph.graph_gates.some(
      (gate) =>
        gate.state === "APPROVED"
        && gate.decided_at !== null
        && gate.decided_at > (lastCompleted ?? gate.opened_at),
    );
    if (reopening) {
      return "looks claimable (halted lifecycle with a fresh gate approval) — "
        + "an empty claim contradicts this listing";
    }
    const openGates = graph.graph_gates.filter((gate) => gate.state === "OPEN").length;
    return openGates > 0
      ? `halted at ${openGates} open gate(s); waiting for a decision, not a worker`
      : `halted lifecycle with run(s) in state ${states} and no fresh gate approval`;
  }

  return "looks claimable — an empty claim contradicts this listing";
}

export function explainEmptyQueue(
  graphs: readonly QueueGraphRow[],
  supported: Iterable<string>,
  targetGraphId: string | null = null,
): readonly string[] {
  if (graphs.length === 0) {
    return [targetGraphId
      ? `Queue diagnosis: target graph ${targetGraphId} was not found in this repository scope.`
      : "Queue diagnosis: no graph appeared in this repository's newest bounded diagnostic sample."];
  }
  const supportedSet = new Set(supported);
  return [
    `Queue diagnosis (${graphs.length} graph(s), newest first${targetGraphId ? ", exact target" : ""}):`,
    ...graphs.map(
      (graph) =>
        `  graph ${graph.id} (created ${graph.created_at}): ${excludingReason(graph, supportedSet)}`,
    ),
  ];
}
