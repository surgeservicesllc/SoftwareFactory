import { setTimeout as sleep } from "node:timers/promises";

import { tryResolveClaudeAuth } from "@/lib/providers/claude-auth";
import { buildClaudeNodeExecutor } from "@/lib/worker/claude-node-executor";
import { executeDeterministicNode } from "@/lib/worker/deterministic-node-executor";
import { compileClaimedGraph, parseClaimedGraph, runClaimedGraph } from "@/lib/worker/graph-run";
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

    const compiled = compileClaimedGraph(parsed.graph);
    if (!compiled.ok) {
      process.stderr.write(`Claimed graph does not compile: ${compiled.detail}\n`);
      await store.completeRun(parsed.graph.graph_run_id, "FAILED", false, compiled.detail);
      continue;
    }

    process.stdout.write(
      `Running graph ${parsed.graph.graph_id} (${compiled.graph.nodes.length} nodes, `
      + `max parallelism ${compiled.graph.maxParallelism}): ${parsed.graph.goal}\n`,
    );

    const executor = buildClaudeNodeExecutor(auth.resolution, {
      goal: parsed.graph.goal,
      projectName: "SoftwareFactory",
      repositoryFullName: process.env.GITHUB_REPOSITORY ?? "surgeservicesllc/SoftwareFactory",
      defaultBranch: "main",
      workingDirectory: process.cwd(),
    });

    const summary = await runClaimedGraph(parsed.graph, compiled.graph, store, async (node, attempt, inputs) => {
      // Dispatch by declared executor. A NONE-tier node never touches the
      // model, and work this worker cannot honestly perform fails with the
      // reason instead of being quietly routed to the CLI.
      const outcome = node.executor === "DETERMINISTIC"
        ? executeDeterministicNode(node, inputs)
        : node.executor === "ANCHOR"
          ? {
              status: "FAILED" as const,
              retryable: false,
              error:
                `Anchor node ${node.nodeKey} needs real command execution (tests, probes), `
                + "which the read-only analysis worker does not wire. Anchor evidence belongs "
                + "to the Phase 1C workspace path.",
            }
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
      + `${summary.incompleteness ? ` — ${summary.incompleteness}` : ""}\n`,
    );

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

  process.stdout.write("SoftwareFactory graph worker is done.\n");
}

main().catch((error) => {
  process.stderr.write(`SoftwareFactory graph worker stopped: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
