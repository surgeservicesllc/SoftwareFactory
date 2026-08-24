import { setTimeout as sleep } from "node:timers/promises";

import { describeDrainOutcome } from "@/lib/graph/drain-report";
import { tryResolveClaudeAuth } from "@/lib/providers/claude-auth";
import { buildClaudeNodeExecutor } from "@/lib/worker/claude-node-executor";
import { executeDeterministicNode } from "@/lib/worker/deterministic-node-executor";
import { buildAnchorNodeExecutor } from "@/lib/worker/anchor-node-executor";
import { compileClaimedGraph, parseClaimedGraph, repositoryMismatch, runClaimedGraph } from "@/lib/worker/graph-run";
import { SupabaseGraphStore } from "@/lib/worker/graph-store";

/**
 * The graph executor worker.
 *
 * Claims PLANNED graphs the console recorded, compiles them back through the
 * engine, and runs their nodes — in parallel up to the graph's own budget —
 * through the subscription transport, persisting every transition. This is
 * the wire that turns "Use template" from a recorded plan into executed,
 * durable work.
 *
 * Modes: `--once` claims at most one graph; `--drain` claims until the queue
 * answers empty; the default loops with a poll interval until signalled.
 */

const once = process.argv.includes("--once");
const drain = process.argv.includes("--drain");
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  if (process.env.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED?.trim() !== "true") {
    process.stdout.write("SoftwareFactory graph worker is disabled. Set SOFTWAREFACTORY_GRAPH_WORKER_ENABLED=true to start it.\n");
    return;
  }

  const workerId = process.env.SOFTWAREFACTORY_WORKER_ID?.trim() || `graph-worker-${process.pid}`;
  const pollMs = Number(process.env.SOFTWAREFACTORY_GRAPH_WORKER_POLL_MS ?? "15000");

  const auth = tryResolveClaudeAuth();
  if ("failure" in auth) {
    // No credential is a stop, not a mock: nodes will not pretend to run.
    throw new Error(`The Claude subscription credential is not usable: ${auth.failure.message}`);
  }

  const store = SupabaseGraphStore.create({
    url: requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    workerId,
  });

  process.stdout.write(`SoftwareFactory graph worker ${workerId} is ready.\n`);

  let graphsRun = 0;
  do {
    const claim = await store.claimPlannedGraph();
    if (claim === null) {
      if (once || drain) break;
      await sleep(pollMs);
      continue;
    }

    const parsed = parseClaimedGraph(claim);
    if (!parsed.ok) {
      // The claim already created the run; an unusable projection must close
      // it honestly rather than stranding it RUNNING forever.
      const runId = (claim as { graph_run_id?: string }).graph_run_id;
      process.stderr.write(`Claimed graph is unusable: ${parsed.detail}\n`);
      if (runId) await store.completeRun(runId, "FAILED", false, parsed.detail);
      continue;
    }

    // A read-only analysis worker reads the tree it is checked out on. If the
    // graph's project is bound to a different repository, running it anyway
    // would produce confident findings about the wrong codebase and file them
    // under this project — a wrong answer that looks exactly like a right one.
    // A project with no repository linked has nothing to contradict, so it
    // proceeds; only a definite mismatch stops here.
    const mismatch = repositoryMismatch(parsed.graph.project_repository, process.env.GITHUB_REPOSITORY);
    if (mismatch) {
      process.stderr.write(`${mismatch}\n`);
      await store.completeRun(parsed.graph.graph_run_id, "FAILED", false, mismatch);
      continue;
    }

    const compiled = compileClaimedGraph(parsed.graph);
    if (!compiled.ok) {
      process.stderr.write(`Claimed graph does not compile: ${compiled.detail}\n`);
      await store.completeRun(parsed.graph.graph_run_id, "FAILED", false, compiled.detail);
      continue;
    }

    graphsRun += 1;
    process.stdout.write(
      `Running graph ${parsed.graph.graph_id} (${compiled.graph.nodes.length} nodes, `
      + `max parallelism ${compiled.graph.maxParallelism}): ${parsed.graph.goal}\n`,
    );

    const repositoryFullName = process.env.GITHUB_REPOSITORY ?? "surgeservicesllc/SoftwareFactory";
    const executor = buildClaudeNodeExecutor(auth.resolution, {
      goal: parsed.graph.goal,
      projectName: "SoftwareFactory",
      repositoryFullName,
      defaultBranch: "main",
      workingDirectory: process.cwd(),
    });
    // Observations, not actions: CI's verdict for this checked-out commit, a
    // production health probe, and a policy refusal for deployment. The
    // instruments come from the workflow environment; an absent one reads as
    // Not Connected in the node's own record rather than as a guess.
    const anchorExecutor = buildAnchorNodeExecutor({
      repositoryFullName,
      headSha: process.env.GITHUB_SHA ?? null,
      gitHubToken: process.env.SOFTWAREFACTORY_CHECKS_TOKEN ?? null,
      productionUrl: process.env.SOFTWAREFACTORY_PRODUCTION_URL ?? null,
      // The repository's own definition of "CI passed" — the same names the
      // Phase 1C worker waits for. Same env, same pipe-separated format.
      requiredCheckNames: (process.env.SOFTWAREFACTORY_REQUIRED_CHECKS ?? "")
        .split("|")
        .map((name) => name.trim())
        .filter(Boolean),
    });

    const summary = await runClaimedGraph(parsed.graph, compiled.graph, store, async (node, attempt, inputs) => {
      // Dispatch by declared executor. A NONE-tier node never touches the
      // model, and every executor this worker declares is one it honestly
      // provides — WORKER_SUPPORTED_EXECUTORS is what the claim matched.
      const outcome = node.executor === "DETERMINISTIC"
        ? executeDeterministicNode(node, inputs)
        : node.executor === "ANCHOR"
          ? await anchorExecutor(node)
          : await executor(node, attempt, inputs);
      if (outcome.status === "FAILED") {
        // The database keeps the error on the node_run; the log keeps it
        // where a person reading the drain can see it without a query.
        process.stderr.write(`node ${node.nodeKey} attempt ${attempt} failed: ${outcome.error.slice(0, 400)}\n`);
      }
      return outcome;
    });
    process.stdout.write(
      `Graph run ${parsed.graph.graph_run_id} finished ${summary.finalState}: `
      + `${summary.nodesSucceeded} succeeded, ${summary.nodesFailed} failed`
      + `${summary.reusedNodes.length > 0 ? `, ${summary.reusedNodes.length} reused from this graph's earlier runs (${summary.reusedNodes.join(", ")})` : ""}`
      + `${summary.awaitingGate.length > 0 ? `, ${summary.awaitingGate.length} halted at a lifecycle gate (${summary.awaitingGate.join(", ")})` : ""}`
      + `${summary.incompleteness ? ` — ${summary.incompleteness}` : ""}\n`,
    );

    /*
     * Anchored automatic gates decide themselves — after the run has closed,
     * so the decision is newer than the close and the claim's reopen rule
     * sees it. The database refuses everything the anchored-evidence rule
     * refuses (human gates, zero anchors, gates a person already decided),
     * so every halted gate is offered and the refusals are reported, not
     * hidden. An approval makes the graph claimable again, and this same
     * drain loop picks it straight back up.
     */
    for (const nodeKey of summary.awaitingGate) {
      const claimedNode = parsed.graph.nodes.find((entry) => entry.node_key === nodeKey);
      if (!claimedNode?.node_id || claimedNode.gate_kind !== "AUTOMATIC") continue;
      const decision = await store.decideAutomaticGate(claimedNode.node_id);
      process.stdout.write(
        `Automatic gate at ${nodeKey}: ${decision.approved ? "approved — the graph is claimable again" : decision.detail}\n`,
      );
    }

    if (summary.capacityWithheld) {
      // The credential is out of capacity; every further claim would burn a
      // run against the same refusal. Stop and let a later dispatch — after
      // the limit resets — drain what remains.
      process.stdout.write(
        "The provider is withholding capacity (session or rate limit). "
        + "Stopping this drain so graphs keep their chances for a dispatch the provider will fuel.\n",
      );
      break;
    }

    if (once) break;
  } while (!stopping);

  process.stdout.write(`${describeDrainOutcome(graphsRun)}\n`);
  if (graphsRun === 0) {
    // "Nothing ran" alone costs a dispatch to learn nothing. Say which claim
    // filter excludes each graph — ids and states only, never goal text.
    for (const line of await store.explainEmptyQueue()) {
      process.stdout.write(`${line}\n`);
    }
  }
  process.stdout.write("SoftwareFactory graph worker is done.\n");
}

main().catch((error) => {
  process.stderr.write(`SoftwareFactory graph worker stopped: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
