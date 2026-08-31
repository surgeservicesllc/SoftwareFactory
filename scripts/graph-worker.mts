import { describeDrainOutcome } from "@/lib/graph/drain-report";
import { GROK_DEPLOY_READINESS_GOAL } from "@/lib/grok/provider-admission";
import { tryResolveClaudeAuth } from "@/lib/providers/claude-auth";
import { buildAnchorNodeExecutor } from "@/lib/worker/anchor-node-executor";
import { buildClaudeNodeExecutor } from "@/lib/worker/claude-node-executor";
import { executeDeterministicNode } from "@/lib/worker/deterministic-node-executor";
import { resolveAdmittedClaudeAuth } from "@/lib/worker/execution-admission";
import {
  compileClaimedGraph,
  parseClaimedGraph,
  runClaimedGraph,
} from "@/lib/worker/graph-run";
import { SupabaseGraphStore } from "@/lib/worker/graph-store";
import {
  graphClaimTargetMismatch,
  SupabaseGraphTargetResolver,
} from "@/lib/worker/graph-target";
import { GitHubGraphReadTokenProvider } from "@/lib/worker/github";
import { GraphReadWorkspaceManager } from "@/lib/worker/graph-workspace";

/**
 * Exact-target graph executor.
 *
 * The reviewed SoftwareFactory checkout is worker runtime only. A dispatched
 * graph UUID resolves one database-owned GitHub target, obtains a read-only
 * repository-scoped installation token, and prepares a separate detached tree
 * at the immutable base SHA before a durable claim or provider call can occur.
 */

const once = process.argv.includes("--once");
const drain = process.argv.includes("--drain");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_ABORT_DETAIL = Object.freeze({
  invalidProjection: "The claimed graph projection failed protocol-v4 validation.",
  targetMismatch: "The claimed graph did not preserve its exact repository workspace target.",
  wakeReceiptFailure: "The claimed graph did not match the exact durable Grok Resume wake receipt.",
  wakePayloadMissing: "The claimed initial Grok graph has a Resume intent but this dispatch carried no exact wake identity.",
  compileFailure: "The claimed graph failed the execution contract before any node started.",
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredUuidEnv(name: string): string {
  const value = requiredEnv(name);
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be an exact UUID.`);
  return value;
}

function optionalUuidEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be an exact UUID when supplied.`);
  return value;
}

function optionalPositiveIntegerEnv(name: string): number | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer when supplied.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe positive integer when supplied.`);
  }
  return parsed;
}

async function main() {
  if (process.env.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED?.trim() !== "true") {
    process.stdout.write("SoftwareFactory graph worker is disabled. Set SOFTWAREFACTORY_GRAPH_WORKER_ENABLED=true to start it.\n");
    return;
  }
  if (!once || drain) {
    throw new Error("The graph worker accepts only an exact-target --once invocation.");
  }

  const workerId = process.env.SOFTWAREFACTORY_WORKER_ID?.trim() || `graph-worker-${process.pid}`;
  const targetGraphId = requiredUuidEnv("SOFTWAREFACTORY_TARGET_GRAPH_ID");
  const grokWakeIntentId = optionalUuidEnv("SOFTWAREFACTORY_GROK_WAKE_INTENT_ID");
  const grokControlRevision = optionalPositiveIntegerEnv("SOFTWAREFACTORY_GROK_CONTROL_REVISION");
  if ((grokWakeIntentId === null) !== (grokControlRevision === null)) {
    throw new Error("The exact Grok wake intent and control revision must be supplied together.");
  }
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  // This read happens before claim. Its complete projection is echoed to the
  // protocol-v4 claim, which re-resolves it in the claim transaction.
  const target = await SupabaseGraphTargetResolver.create({
    url: supabaseUrl,
    serviceRoleKey,
  }).resolve(targetGraphId);
  const installationToken = await new GitHubGraphReadTokenProvider().createToken(target);
  const workspaceManager = new GraphReadWorkspaceManager(
    requiredEnv("SOFTWAREFACTORY_GRAPH_WORK_ROOT"),
  );

  await workspaceManager.withWorkspace(target, installationToken.token, async (workspace) => {
    const store = SupabaseGraphStore.create({
      url: supabaseUrl,
      serviceRoleKey,
      workerId,
      repositoryFullName: target.repository_full_name,
      requiredCheckNames: target.required_check_names,
      exactTarget: target,
    });

    process.stdout.write(`SoftwareFactory graph worker ${workerId} resolved its exact target workspace.\n`);
    const claim = await store.claimPlannedGraph();
    if (claim === null) {
      process.stdout.write(`${describeDrainOutcome(0)}\n`);
      for (const line of await store.explainEmptyQueue()) process.stdout.write(`${line}\n`);
      process.stdout.write("SoftwareFactory graph worker is done.\n");
      return;
    }

    const parsed = parseClaimedGraph(claim);
    if (!parsed.ok) {
      const runId = (claim as { graph_run_id?: unknown }).graph_run_id;
      process.stderr.write(`${CLAIM_ABORT_DETAIL.invalidProjection}\n`);
      if (typeof runId === "string" && UUID_PATTERN.test(runId)) {
        await store.abortRun(runId, "FAILED", CLAIM_ABORT_DETAIL.invalidProjection);
      }
      return;
    }

    const targetMismatch = graphClaimTargetMismatch(parsed.graph, target);
    if (targetMismatch) {
      process.stderr.write(`${CLAIM_ABORT_DETAIL.targetMismatch}\n`);
      await store.abortRun(
        parsed.graph.graph_run_id,
        "FAILED",
        CLAIM_ABORT_DETAIL.targetMismatch,
      );
      return;
    }

    const initialGrokClaim = parsed.graph.grok_admission_required
      && (
        parsed.graph.phase1c_state === null
        || parsed.graph.phase1c_state === undefined
        || parsed.graph.phase1c_state === "GRAPH_READY"
      );
    try {
      if (grokWakeIntentId !== null && grokControlRevision !== null) {
        if (parsed.graph.graph_id !== targetGraphId) {
          throw new Error("The claimed graph did not match the exact dispatch target.");
        }
        await store.acknowledgeGrokWake({
          wakeIntentId: grokWakeIntentId,
          controlRevision: grokControlRevision,
          graphId: parsed.graph.graph_id,
          graphRunId: parsed.graph.graph_run_id,
        });
      } else if (initialGrokClaim) {
        // Initial creates have no Resume intent and pass this absence guard.
        // Once any Resume exists, only its opaque dispatch identity may cross
        // this boundary; the database never resolves that identity for us.
        await store.assertNoGrokWakePayloadRequired({
          graphId: parsed.graph.graph_id,
          graphRunId: parsed.graph.graph_run_id,
        });
      }
    } catch {
      const detail = grokWakeIntentId === null
        ? CLAIM_ABORT_DETAIL.wakePayloadMissing
        : CLAIM_ABORT_DETAIL.wakeReceiptFailure;
      process.stderr.write(`${detail}\n`);
      await store.abortRun(parsed.graph.graph_run_id, "FAILED", detail);
      return;
    }

    const compiled = compileClaimedGraph(parsed.graph);
    if (!compiled.ok) {
      process.stderr.write(`${CLAIM_ABORT_DETAIL.compileFailure}\n`);
      await store.abortRun(parsed.graph.graph_run_id, "FAILED", CLAIM_ABORT_DETAIL.compileFailure);
      return;
    }

    process.stdout.write(
      `Running graph ${parsed.graph.graph_id} (${compiled.graph.nodes.length} nodes, `
      + `max parallelism ${compiled.graph.maxParallelism}): ${parsed.graph.goal}\n`,
    );

    const repositoryFullName = target.repository_full_name;
    const anchorExecutor = buildAnchorNodeExecutor({
      templateKey: parsed.graph.template_key ?? null,
      templateVersion: parsed.graph.template_version ?? null,
      templatePlanSha256: parsed.graph.template_plan_sha256 ?? null,
      repositoryFullName,
      baseBranch: target.base_branch,
      baseSha: target.base_sha,
      phase1cState: parsed.graph.phase1c_state ?? null,
      producedChangeSha: parsed.graph.phase1c_head_sha ?? null,
      pullRequestNumber: parsed.graph.pull_request_number ?? null,
      pullRequestUrl: parsed.graph.pull_request_url ?? null,
      validationEvidence: parsed.graph.validation_evidence ?? null,
      mergeCommitSha: parsed.graph.merge_commit_sha ?? null,
      deploymentId: parsed.graph.deployment_id ?? null,
      deploymentUrl: parsed.graph.deployment_url ?? null,
      projectProductionUrl: parsed.graph.project_production_url ?? null,
      gitHubToken: installationToken.token,
      requiredCheckNames: target.required_check_names,
    });

    const summary = await runClaimedGraph(
      parsed.graph,
      compiled.graph,
      store,
      async (node, attempt, inputs) => {
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
                resolvedAuth = await resolveAdmittedClaudeAuth({
                  supabaseUrl,
                  serviceRoleKey,
                  organizationId: parsed.graph.organization_id,
                  admission,
                });
                exactModel = admission.model;
              } else {
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
                defaultBranch: target.base_branch,
                // This is the only directory target code contributes to the
                // provider call. It is detached, verified, and read-only.
                workingDirectory: workspace.directory,
                initialContext: parsed.graph.initial_context ?? null,
                // A deploy-readiness graph persists zero resource declarations,
                // so its provider process receives zero tools as well.
                ...(parsed.graph.goal === GROK_DEPLOY_READINESS_GOAL
                  ? { allowedTools: [] as const }
                  : {}),
                ...(exactModel ? { modelForNode: () => exactModel } : {}),
              });
              return executor(node, attempt, inputs);
            })();
        if (outcome.status === "FAILED") {
          process.stderr.write(`node ${node.nodeKey} attempt ${attempt} failed: ${outcome.error.slice(0, 400)}\n`);
        }
        return outcome;
      },
    );
    process.stdout.write(
      `Graph run ${parsed.graph.graph_run_id} finished ${summary.finalState}`
      + `${summary.paused ? " (paused by request; the graph holds off the queue until resumed)" : ""}: `
      + `${summary.nodesSucceeded} succeeded, ${summary.nodesFailed} failed`
      + `${summary.reusedNodes.length > 0 ? `, ${summary.reusedNodes.length} reused from this graph's earlier runs (${summary.reusedNodes.join(", ")})` : ""}`
      + `${summary.awaitingGate.length > 0 ? `, ${summary.awaitingGate.length} halted at a lifecycle gate (${summary.awaitingGate.join(", ")})` : ""}`
      + `${summary.incompleteness ? ` — ${summary.incompleteness}` : ""}\n`,
    );

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
      process.stdout.write(
        "The provider is withholding capacity. The exact target remains durable for a later exact dispatch.\n",
      );
    }
    process.stdout.write(`${describeDrainOutcome(1)}\n`);
    process.stdout.write("SoftwareFactory graph worker is done.\n");
  });
}

main().catch((error) => {
  process.stderr.write(`SoftwareFactory graph worker stopped: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
