import { setTimeout as sleep } from "node:timers/promises";

import { describeDrainOutcome } from "@/lib/graph/drain-report";
import { GROK_DEPLOY_READINESS_GOAL } from "@/lib/grok/provider-admission";
import { tryResolveClaudeAuth } from "@/lib/providers/claude-auth";
import { buildClaudeNodeExecutor } from "@/lib/worker/claude-node-executor";
import { executeDeterministicNode } from "@/lib/worker/deterministic-node-executor";
import { buildAnchorNodeExecutor } from "@/lib/worker/anchor-node-executor";
import { parseRequiredCheckNames } from "@/lib/graph/release-policy";
import { compileClaimedGraph, parseClaimedGraph, repositoryMismatch, runClaimedGraph } from "@/lib/worker/graph-run";
import { SupabaseGraphStore } from "@/lib/worker/graph-store";
import { resolveAdmittedClaudeAuth } from "@/lib/worker/execution-admission";

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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_ABORT_DETAIL = Object.freeze({
  invalidProjection: "The claimed graph projection failed protocol-v3 validation.",
  repositoryMismatch: "The claimed graph repository did not match this worker checkout.",
  compileFailure: "The claimed graph failed the execution contract before any node started.",
});
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionalUuidEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be a UUID when supplied.`);
  return value;
}

async function main() {
  if (process.env.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED?.trim() !== "true") {
    process.stdout.write("SoftwareFactory graph worker is disabled. Set SOFTWAREFACTORY_GRAPH_WORKER_ENABLED=true to start it.\n");
    return;
  }

  const workerId = process.env.SOFTWAREFACTORY_WORKER_ID?.trim() || `graph-worker-${process.pid}`;
  const pollMs = Number(process.env.SOFTWAREFACTORY_GRAPH_WORKER_POLL_MS ?? "15000");

  const repositoryIdentity = requiredEnv("GITHUB_REPOSITORY");
  const workerRequiredChecks = parseRequiredCheckNames(
    requiredEnv("SOFTWAREFACTORY_REQUIRED_CHECKS"),
  );
  if (!workerRequiredChecks) {
    throw new Error("SOFTWAREFACTORY_REQUIRED_CHECKS is not a safe, unique repository policy.");
  }
  const targetGraphId = optionalUuidEnv("SOFTWAREFACTORY_TARGET_GRAPH_ID");
  if (
    process.env.SOFTWAREFACTORY_TARGET_CLAIM_REQUIRED?.trim() === "true"
    && !targetGraphId
  ) {
    throw new Error("SOFTWAREFACTORY_TARGET_GRAPH_ID is required for this one-shot dispatch.");
  }
  if (targetGraphId && drain) {
    throw new Error("An exact-target graph dispatch must use --once, not --drain.");
  }
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const store = SupabaseGraphStore.create({
    url: supabaseUrl,
    serviceRoleKey,
    workerId,
    repositoryFullName: repositoryIdentity,
    requiredCheckNames: workerRequiredChecks,
    targetGraphId,
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
      const runId = (claim as { graph_run_id?: unknown }).graph_run_id;
      process.stderr.write(`${CLAIM_ABORT_DETAIL.invalidProjection}\n`);
      if (typeof runId === "string" && UUID_PATTERN.test(runId)) {
        await store.abortRun(runId, "FAILED", CLAIM_ABORT_DETAIL.invalidProjection);
      }
      continue;
    }

    // A read-only analysis worker reads the tree it is checked out on. If the
    // graph's project is bound to a different repository, running it anyway
    // would produce confident findings about the wrong codebase and file them
    // under this project — a wrong answer that looks exactly like a right one.
    const mismatch = repositoryMismatch(parsed.graph.project_repository, process.env.GITHUB_REPOSITORY);
    if (mismatch) {
      process.stderr.write(`${CLAIM_ABORT_DETAIL.repositoryMismatch}\n`);
      await store.abortRun(
        parsed.graph.graph_run_id,
        "FAILED",
        CLAIM_ABORT_DETAIL.repositoryMismatch,
      );
      continue;
    }

    const compiled = compileClaimedGraph(parsed.graph);
    if (!compiled.ok) {
      process.stderr.write(`${CLAIM_ABORT_DETAIL.compileFailure}\n`);
      await store.abortRun(parsed.graph.graph_run_id, "FAILED", CLAIM_ABORT_DETAIL.compileFailure);
      continue;
    }

    graphsRun += 1;
    process.stdout.write(
      `Running graph ${parsed.graph.graph_id} (${compiled.graph.nodes.length} nodes, `
      + `max parallelism ${compiled.graph.maxParallelism}): ${parsed.graph.goal}\n`,
    );

    const repositoryFullName = parsed.graph.project_repository;
    // Observations, not actions. Every release identity below came from the
    // service-role claim's graph-scoped Phase 1C bridge projection. GITHUB_SHA,
    // the checkout branch, and any ambient production URL describe worker
    // context, not graph lineage; none may masquerade as this graph's produced
    // change, merge, or deployment.
    const anchorExecutor = buildAnchorNodeExecutor({
      templateKey: parsed.graph.template_key ?? null,
      templateVersion: parsed.graph.template_version ?? null,
      templatePlanSha256: parsed.graph.template_plan_sha256 ?? null,
      repositoryFullName: parsed.graph.project_repository,
      baseBranch: parsed.graph.base_branch ?? null,
      baseSha: parsed.graph.base_sha ?? null,
      phase1cState: parsed.graph.phase1c_state ?? null,
      producedChangeSha: parsed.graph.phase1c_head_sha ?? null,
      pullRequestNumber: parsed.graph.pull_request_number ?? null,
      pullRequestUrl: parsed.graph.pull_request_url ?? null,
      validationEvidence: parsed.graph.validation_evidence ?? null,
      mergeCommitSha: parsed.graph.merge_commit_sha ?? null,
      deploymentId: parsed.graph.deployment_id ?? null,
      deploymentUrl: parsed.graph.deployment_url ?? null,
      projectProductionUrl: parsed.graph.project_production_url ?? null,
      gitHubToken: process.env.SOFTWAREFACTORY_CHECKS_TOKEN ?? null,
      // The repository's own definition of "CI passed" — the same names the
      // Phase 1C worker waits for. Same env, same pipe-separated format.
      requiredCheckNames: parsed.graph.required_check_names ?? [],
    });

    const summary = await runClaimedGraph(parsed.graph, compiled.graph, store, async (node, attempt, inputs) => {
      // Dispatch by declared executor. A NONE-tier node never touches the
      // model, and every executor this worker declares is one it honestly
      // provides — WORKER_SUPPORTED_EXECUTORS is what the claim matched.
      const outcome = node.executor === "DETERMINISTIC"
        ? executeDeterministicNode(node, inputs)
        : node.executor === "ANCHOR"
          ? await anchorExecutor(node)
          : await (async () => {
            const claimedNode = parsed.graph.nodes.find((entry) => entry.node_key === node.nodeKey);
            const admission = claimedNode?.execution_admission ?? null;
            let resolvedAuth;
            let exactModel: string | null = null;
            if (admission) {
              // Re-read and open only this immutable admission immediately
              // before provider use. The database revalidates every mutable
              // revision again; no ambient or neighboring account slot can
              // substitute for it.
              resolvedAuth = await resolveAdmittedClaudeAuth({
                supabaseUrl,
                serviceRoleKey,
                organizationId: parsed.graph.organization_id,
                admission,
              });
              exactModel = admission.model;
            } else {
              // Retained only for pre-admission non-Grok graphs. Canonical
              // Full Lifecycle claims cannot reach this branch: their parser
              // requires one exact admission on every MODEL node.
              const legacy = tryResolveClaudeAuth();
              if ("failure" in legacy) {
                throw new Error(`The Claude subscription credential is not usable: ${legacy.failure.message}`);
              }
              resolvedAuth = legacy.resolution;
            }
            const executor = buildClaudeNodeExecutor(resolvedAuth, {
              goal: parsed.graph.goal,
              projectName: parsed.graph.project_name,
              repositoryFullName,
              defaultBranch: parsed.graph.base_branch ?? parsed.graph.project_default_branch,
              workingDirectory: process.cwd(),
              initialContext: parsed.graph.initial_context ?? null,
              // A deploy-readiness graph persists zero resource declarations,
              // so its provider process receives zero tools as well. Its exact
              // verifier schemas must return BLOCKED when evidence is absent.
              ...(parsed.graph.goal === GROK_DEPLOY_READINESS_GOAL
                ? { allowedTools: [] as const }
                : {}),
              ...(exactModel ? { modelForNode: () => exactModel } : {}),
            });
            return executor(node, attempt, inputs);
          })();
      if (outcome.status === "FAILED") {
        // The database keeps the error on the node_run; the log keeps it
        // where a person reading the drain can see it without a query.
        process.stderr.write(`node ${node.nodeKey} attempt ${attempt} failed: ${outcome.error.slice(0, 400)}\n`);
      }
      return outcome;
    });
    process.stdout.write(
      `Graph run ${parsed.graph.graph_run_id} finished ${summary.finalState}`
      + `${summary.paused ? " (paused by request; the graph holds off the queue until resumed)" : ""}: `
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
    for (const nodeKey of summary.finalState === "PARTIAL" || summary.finalState === "COMPLETED"
      ? summary.awaitingGate
      : []) {
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
