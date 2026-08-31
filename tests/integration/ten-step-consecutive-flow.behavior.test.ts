// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import type { CompiledNode } from "@/lib/graph/compiler";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import type { NodeExecutionResult } from "@/lib/graph/runner";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";
import { WORKER_SUPPORTED_EXECUTORS } from "@/lib/worker/executor-support";
import { buildAnchorNodeExecutor } from "@/lib/worker/anchor-node-executor";
import {
  compileClaimedGraph,
  parseClaimedGraph,
  runClaimedGraph,
  type GraphRunStore,
} from "@/lib/worker/graph-run";

/**
 * One request, all ten steps, consecutively, to a completed run.
 *
 * The other lifecycle suites each pin one join of the machine — the template's
 * shape, a gate's refusals, the resume read, the automatic decision. This one
 * drives the whole flow the way production does, end to end: the owner plants
 * the `full_lifecycle` template through `create_graph_from_plan` (the exact
 * write behind the factory pages' launch control), and a worker claims and
 * executes window after window — halting at the ARCHITECTURE design gate, the
 * TEST merge gate, and the DEPLOYMENT release-acceptance gate. All three are
 * HUMAN boundaries; no graph worker approves its own merge or release.
 *
 * What the walk must prove, because the ten factory pages read exactly this:
 *
 *   - Step N's recorded result is the persisted state step N+1 consumes: no
 *     node executes twice across the windows (gate-halted and completed work
 *     is reused, never re-paid).
 *   - Every one of the eleven stages holds a COMPLETED node at the end, with
 *     an artifact recorded for each — full lineage from the request to the
 *     monitoring probe.
 *   - The gates land as policy places them and their decisions are audited.
 *   - `list_graph_runs` — the one projection every factory page renders —
 *     reports the finished truth, identically on a second read (refresh), and
 *     reports nothing at all to a signed-in outsider.
 */


const WORKER = "ten-step-walk-worker";
const BASE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PRODUCED_CHANGE_SHA = "0123456789abcdef0123456789abcdef01234567";
const MERGE_COMMIT_SHA = "89abcdef0123456789abcdef0123456789abcdef";
const REPOSITORY = "surgeservicesllc/SoftwareFactory";
const REQUIRED_CHECKS = ["CI"];
const PRODUCTION_URL = "https://softwarefactory-exact-test.vercel.app";
const DEPLOYMENT_ID = "30000000-0000-4000-8000-00000000e2e1";
const PHASE1C_RUN_ID = "40000000-0000-4000-8000-00000000e2e1";
const PULL_REQUEST_NUMBER = 309;
const ownerId = "00000000-0000-4000-8000-00000000e2e1";
const outsiderId = "00000000-0000-4000-8000-00000000e2e2";
const organizationId = "10000000-0000-4000-8000-00000000e2e1";
const projectId = "20000000-0000-4000-8000-00000000e2e1";

function modelFixture(node: Pick<CompiledNode, "nodeKey" | "capability">): unknown {
  switch (node.capability) {
    case "planning":
    case "architecture":
      return { steps: [{ description: `${node.nodeKey} step`, rationale: "test fixture" }] };
    case "discovery":
      return {
        schemaVersion: 1,
        searchAreas: ["repository"],
        candidates: [],
        keyFindings: ["No candidate is needed for this execution-boundary test."],
        recommendedNextSteps: ["Continue through the recorded lifecycle."],
      };
    case "evaluation":
      return {
        schemaVersion: 1,
        candidates: [{
          name: "Build",
          scores: {
            licenseLegal: 8,
            securitySafety: 8,
            maintenanceActivity: 8,
            featureCompleteness: 8,
            performanceScalability: 8,
            documentation: 8,
            communityEcosystem: 8,
            easeOfIntegration: 8,
            reliabilityTesting: 8,
            codeQuality: 8,
          },
          riskLevel: "LOW",
          recommendation: "CONSIDER",
          redFlags: [],
          rationale: "Stable test-data candidate.",
        }],
        ranking: ["Build"],
        topCandidate: { name: "Build", strengths: ["Deterministic"], limitations: [] },
        recommendationSummary: "Use the deterministic test-data candidate.",
        assumptions: [],
      };
    case "decision":
      return {
        schemaVersion: 1,
        paths: ["USE", "CONNECT", "ADAPT", "FORK", "BUILD"].map((path) => ({
          path,
          score: path === "BUILD" ? 90 : 40,
          pros: ["Test-data pro"],
          cons: ["Test-data con"],
          fitNotes: "Deterministic fixture.",
        })),
        chosenPath: "BUILD",
        subject: "",
        rationale: ["Exercise the lifecycle."],
        executionPlan: [{ step: "Build", detail: "Continue through the test graph." }],
        integrationBoundaries: { weOwn: ["fixture"], counterpartOwns: [] },
        risks: [],
        openQuestions: [],
      };
    case "synthesis":
    case "reporting":
      return { summary: "Fixture report", findings: [], recommendation: "Continue." };
    default:
      return { findings: [] };
  }
}

let db: PGlite;
let graphId: string;

async function asUser(client: PGlite, userId: string) {
  await client.exec("reset role");
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await client.exec("set role authenticated");
}

async function asServiceRole(client: PGlite) {
  await client.exec("reset role");
  await client.query("select set_config('request.jwt.claim.sub', '', false)");
  await client.exec("set role service_role");
}

async function reset(client: PGlite) {
  await client.exec("reset role");
}

/** The production store's shape, over PGlite instead of supabase-js. */
function pgliteStore(client: PGlite): GraphRunStore {
  return {
    async recordNodeState(nodeRunId, state, detail, execution) {
      await asServiceRole(client);
      await client.query(
        "select public.record_node_state_as_worker($1, $2::uuid, $3::public.graph_node_state, $4, $5, $6, $7)",
        [WORKER, nodeRunId, state, detail ?? null, execution?.provider ?? null, execution?.model ?? null, execution?.latencyMs ?? null],
      );
      await reset(client);
    },
    async recordArtifact(graphRunId, kind, payload, nodeRunId) {
      await asServiceRole(client);
      await client.query(
        "select public.record_graph_artifact_as_worker($1, $2::uuid, $3::public.graph_artifact_kind, $4::jsonb, $5::uuid)",
        [WORKER, graphRunId, kind, JSON.stringify(payload ?? {}), nodeRunId ?? null],
      );
      await reset(client);
    },
    async readPriorNodeResults(priorGraphId) {
      await asServiceRole(client);
      const result = await client.query<{
        model: string | null;
        node_key: string;
        payload: unknown;
        provider: string | null;
      }>(
        `select node_key, payload, provider, model
           from public.read_prior_node_results_as_worker_v2($1, $2::uuid, 2)`,
        [WORKER, priorGraphId],
      );
      await reset(client);
      return new Map(result.rows.map((row) => [row.node_key, {
        output: row.payload,
        provider: row.provider ?? undefined,
        model: row.model ?? undefined,
      }]));
    },
    async openGate(nodeId, graphRunId, anchorCount) {
      await asServiceRole(client);
      await client.query(
        "select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, $4)",
        [WORKER, nodeId, graphRunId, anchorCount],
      );
      await reset(client);
    },
    async completeReviewerWithVerifications(verifierNodeRunId, artifactPayload, execution, verifications) {
      await asServiceRole(client);
      await client.query(
        `select public.complete_reviewer_with_verifications_as_worker(
           $1, $2::uuid, $3::jsonb, $4, $5, $6, $7::jsonb
         )`,
        [WORKER, verifierNodeRunId, JSON.stringify(artifactPayload),
          execution.provider, execution.model, execution.latencyMs,
          JSON.stringify(verifications)],
      );
      await reset(client);
    },
    async completeRun(graphRunId, state, hadPartialInput, detail, usage) {
      await asServiceRole(client);
      await client.query(
        "select public.complete_graph_run_with_phase1c_bridge_as_worker($1, $2::uuid, $3::public.graph_run_state, $4, $5, $6, null, $7)",
        [
          WORKER, graphRunId, state, hadPartialInput,
          usage?.tokensUsed ?? null, usage?.costMicros ?? null, detail ?? null,
        ],
      );
      await reset(client);
    },
  };
}

async function claim(): Promise<unknown> {
  await asServiceRole(db);
  const claimed = await db.query<{ claim_planned_graph_v3: unknown }>(
    "select public.claim_planned_graph_v3($1, $2::text[], $3, $4::jsonb, 3)",
    [WORKER, WORKER_SUPPORTED_EXECUTORS, REPOSITORY, JSON.stringify(REQUIRED_CHECKS)],
  );
  await reset(db);
  return claimed.rows[0].claim_planned_graph_v3;
}

async function listRunsAs(userId: string): Promise<Array<Record<string, unknown>>> {
  await asUser(db, userId);
  const result = await db.query<Record<string, unknown>>(
    "select * from public.list_graph_runs($1::uuid, 20)",
    [organizationId],
  );
  await reset(db);
  return result.rows;
}

beforeAll(async () => {
  // The chain, restored from a snapshot rather than replayed; the
  // helper keys its cache on the CONTENT of every migration, and
  // asserts coverage of the whole directory.
  db = await createMigratedDatabase();
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
    insert into public.organizations (id, name, slug, created_by)
    values ('${organizationId}', 'Ten Step Tenant', 'ten-step-tenant', '${ownerId}');
    insert into public.projects (
      id, organization_id, name, status, github_repository, created_by
    ) values (
      '${projectId}', '${organizationId}', 'Ten Step Project', 'active',
      '${REPOSITORY}', '${ownerId}'
    );
    insert into public.connections (
      id, organization_id, name, provider, status, secret_reference, created_by
    ) values (
      '50000000-0000-4000-8000-00000000e2e1', '${organizationId}',
      'GitHub', 'github', 'connected', 'env://GITHUB_APP', '${ownerId}'
    );
    insert into public.github_installations (
      id, organization_id, connection_id, external_installation_id, app_id,
      app_slug, account_id, account_login, account_type, target_type,
      repository_selection, status, installed_at, created_by
    ) values (
      '60000000-0000-4000-8000-00000000e2e1', '${organizationId}',
      '50000000-0000-4000-8000-00000000e2e1', 970001, 970002,
      'ten-step-app', 970003, 'surgeservicesllc', 'Organization', 'Organization',
      'selected', 'active', now(), '${ownerId}'
    );
    insert into public.github_repositories (
      id, organization_id, installation_id, external_repository_id,
      owner_login, name, full_name, default_branch, html_url, private,
      visibility, selected, github_updated_at
    ) values (
      '70000000-0000-4000-8000-00000000e2e1', '${organizationId}',
      '60000000-0000-4000-8000-00000000e2e1', 970004,
      'surgeservicesllc', 'SoftwareFactory', '${REPOSITORY}', 'main',
      'https://github.com/${REPOSITORY}', true, 'private', true, now()
    );
    insert into public.project_connections (
      organization_id, project_id, connection_id, github_repository_id,
      is_primary, created_by
    ) values (
      '${organizationId}', '${projectId}',
      '50000000-0000-4000-8000-00000000e2e1',
      '70000000-0000-4000-8000-00000000e2e1', true, '${ownerId}'
    );
  `);

  const template = findTemplate("full_lifecycle");
  const built = buildLaunchPlan(template!, budgetForTemplate(template!, DEFAULT_GRAPH_BUDGET));
  if (!built.ok) throw new Error(`full_lifecycle did not compile: ${built.errors.join("; ")}`);

  await asUser(db, ownerId);
  const created = await db.query<{ id: string }>(
    `select public.create_graph_from_plan($1, $2, $3, $4::public.graph_topology, $5::jsonb,
              $6::public.risk_level, $7, $8::jsonb, $9::jsonb, $10::jsonb) as id`,
    [
      organizationId, projectId, built.plan.goal, built.plan.topology,
      JSON.stringify(built.plan.topologyReasons), built.plan.riskLevel,
      built.plan.requiresOwnerApproval,
      JSON.stringify(built.plan.nodes), JSON.stringify(built.plan.edges),
      JSON.stringify(built.plan.budget),
    ],
  );
  graphId = created.rows[0].id;
  await reset(db);
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("the ten steps, walked consecutively", { timeout: 240_000 }, () => {
  /** Every executor call across every window, counted per node. */
  const executions = new Map<string, number>();
  let windows = 0;
  let finalState: string | null = null;

  it("drains the lifecycle to COMPLETED across gate-halted windows", async () => {
    const store = pgliteStore(db);
    const deploymentStatusUrl = `https://api.github.com/repos/${REPOSITORY}/deployments/42/statuses?per_page=1`;
    const anchorExecutor = buildAnchorNodeExecutor({
      templateKey: "full_lifecycle",
      templateVersion: 2,
      repositoryFullName: REPOSITORY,
      baseBranch: "main",
      baseSha: BASE_SHA,
      phase1cState: "DEPLOYMENT_RECORDED",
      producedChangeSha: PRODUCED_CHANGE_SHA,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      pullRequestUrl: `https://github.com/${REPOSITORY}/pull/${PULL_REQUEST_NUMBER}`,
      validationEvidence: {
        agent_run_id: PHASE1C_RUN_ID,
        head_sha: PRODUCED_CHANGE_SHA,
        validation_round: 1,
        validations: [{ name: "diff-check", status: "passed", duration_ms: 10 }],
      },
      mergeCommitSha: MERGE_COMMIT_SHA,
      deploymentId: DEPLOYMENT_ID,
      deploymentUrl: PRODUCTION_URL,
      gitHubToken: "ghs_read_scoped_test_token",
      requiredCheckNames: REQUIRED_CHECKS,
      deploymentMaxAttempts: 1,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith(`/commits/${PRODUCED_CHANGE_SHA}/check-runs?per_page=100`)) {
          return new Response(JSON.stringify({
            check_runs: [{
              id: 1,
              name: "CI",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.example/checks/1",
            }],
          }), { status: 200 });
        }
        if (url.endsWith(`/pulls/${PULL_REQUEST_NUMBER}`)) {
          return new Response(JSON.stringify({
            number: PULL_REQUEST_NUMBER,
            html_url: `https://github.com/${REPOSITORY}/pull/${PULL_REQUEST_NUMBER}`,
            state: "open",
            draft: true,
            merged_at: null,
            head: { sha: PRODUCED_CHANGE_SHA, repo: { full_name: REPOSITORY } },
            base: { ref: "main", repo: { full_name: REPOSITORY } },
          }), { status: 200 });
        }
        if (url.endsWith("/deployments?environment=Production&per_page=100")) {
          return new Response(JSON.stringify([{
            id: 42,
            sha: MERGE_COMMIT_SHA,
            ref: "main",
            environment: "Production",
            task: "deploy",
            creator: { login: "vercel[bot]" },
          }]), { status: 200 });
        }
        if (url === deploymentStatusUrl) {
          return new Response(JSON.stringify([{
            state: "success",
            creator: { login: "vercel[bot]" },
            environment_url: "https://softwarefactory-exact-test.vercel.app",
          }]), { status: 200 });
        }
        if (url === PRODUCTION_URL) return new Response("ok", { status: 200 });
        return new Response("not found", { status: 404 });
      },
    });

    for (let window = 1; window <= 8; window += 1) {
      const claimed = parseClaimedGraph(await claim());
      if (claimed === null || !claimed.ok) break;
      expect(claimed.graph.graph_id).toBe(graphId);
      windows += 1;

      const compiled = compileClaimedGraph(claimed.graph);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;

      const summary = await runClaimedGraph(claimed.graph, compiled.graph, store, async (node): Promise<NodeExecutionResult> => {
        executions.set(node.nodeKey, (executions.get(node.nodeKey) ?? 0) + 1);
        if (node.executor === "ANCHOR") {
          // Exercise the production anchor boundary, including exact CI SHA,
          // exact Vercel deployment identity, and the canonical health probe.
          // A blanket success here previously hid the permanent Step 9 fail.
          return anchorExecutor(node);
        }
        return {
          status: "SUCCEEDED",
          output: modelFixture(node),
          provider: node.executor === "MODEL" ? "openai" : "deterministic",
          model: node.executor === "MODEL" ? "gpt-5.3-codex" : undefined,
          latencyMs: 5,
          tokensUsed: 10,
        };
      });
      finalState = summary.finalState;
      if (summary.finalState === "COMPLETED") break;

      // Between windows the worker's drain decides what it may and a person
      // decides what only a person may — exactly as production does.
      await reset(db);
      const open = await db.query<{ id: string; kind: string; node_id: string; node_key: string }>(
        `select gate.id, gate.kind::text as kind, node.id as node_id, node.node_key
           from public.graph_gates gate
           join public.graph_nodes node on node.id = gate.node_id
          where gate.graph_id = $1 and gate.state = 'OPEN'`,
        [graphId],
      );
      for (const gate of open.rows) {
        if (gate.kind === "HUMAN") {
          await asUser(db, ownerId);
          await db.query(
            "select public.decide_node_gate($1::uuid, true, 'Approved by the owner in the ten-step walk.')",
            [gate.id],
          );
          await reset(db);
        } else {
          await asServiceRole(db);
          await db.query(
            "select public.decide_automatic_gate_as_worker($1, $2::uuid)",
            [WORKER, gate.node_id],
          );
          await reset(db);
        }
      }
    }

    expect(finalState, "the drain must end in a completed run").toBe("COMPLETED");
    expect(windows, "the gates must have split the work into more than one window").toBeGreaterThan(1);
    expect(await claim(), "a completed lifecycle must leave the queue").toBeNull();
  });

  it("paid for each step exactly once: recorded work is reused, never re-executed", async () => {
    expect(executions.size).toBeGreaterThan(0);
    const rerun = [...executions.entries()].filter(([, count]) => count !== 1);
    expect(rerun, "no node may execute twice across the windows").toEqual([]);
  });

  it("closed every one of the eleven stages with a completed node and its artifact", async () => {
    await reset(db);
    const stages = await db.query<{ stage: string; completed: number; artifacts: number }>(
      `select node.lifecycle_stage::text as stage,
              count(*) filter (where nr.state = 'COMPLETED')::int as completed,
              count(a.id)::int as artifacts
         from public.graph_nodes node
         join public.node_runs nr on nr.node_id = node.id
         left join public.graph_artifacts a on a.node_run_id = nr.id
        where node.graph_id = $1 and node.lifecycle_stage is not null
        group by node.lifecycle_stage`,
      [graphId],
    );
    const byStage = new Map(stages.rows.map((row) => [row.stage, row]));
    for (const stage of SDLC_STAGES) {
      const slice = byStage.get(stage);
      expect(slice, `stage ${stage} must hold at least one node run`).toBeDefined();
      expect(slice!.completed, `stage ${stage} must complete`).toBeGreaterThan(0);
      expect(slice!.artifacts, `stage ${stage} must record its product`).toBeGreaterThan(0);
    }
  });

  it("decided the gates as policy places them, and audited every decision", async () => {
    await reset(db);
    const gates = await db.query<{ stage: string; kind: string; state: string; decided_by: string | null; anchor_count: number }>(
      `select stage::text as stage, kind::text as kind, state::text as state, decided_by, anchor_count
         from public.graph_gates where graph_id = $1 order by stage`,
      [graphId],
    );
    const human = gates.rows.filter((row) => row.kind === "HUMAN");
    const automatic = gates.rows.filter((row) => row.kind === "AUTOMATIC");
    expect(human.map((row) => row.stage).sort()).toEqual(["ARCHITECTURE", "DEPLOYMENT", "TEST"]);
    for (const gate of human) {
      expect(gate.state).toBe("APPROVED");
      expect(gate.decided_by).toBe(ownerId);
    }
    expect(automatic).toEqual([]);

    const events = await db.query<{ event_type: string; n: number }>(
      `select event_type::text as event_type, count(*)::int as n
         from public.activity_events
        where organization_id = $1 and event_type::text in ('lifecycle.gate_opened', 'lifecycle.gate_approved')
        group by event_type`,
      [organizationId],
    );
    const byType = new Map(events.rows.map((row) => [row.event_type, row.n]));
    expect(byType.get("lifecycle.gate_opened") ?? 0).toBeGreaterThanOrEqual(gates.rows.length);
    expect(byType.get("lifecycle.gate_approved") ?? 0).toBeGreaterThanOrEqual(gates.rows.length);
  });

  it("reports the finished truth through list_graph_runs, identically on refresh", async () => {
    const first = await listRunsAs(ownerId);
    const run = first.find((row) => row.graph_id === graphId && row.state === "COMPLETED");
    expect(run, "the completed lifecycle must appear in the projection").toBeDefined();
    expect(run!.is_lifecycle).toBe(true);

    const nodes = run!.nodes as Array<{ lifecycle_stage: string | null; state: string }>;
    const completedStages = new Set(
      nodes.filter((node) => node.state === "COMPLETED" && node.lifecycle_stage).map((node) => node.lifecycle_stage),
    );
    for (const stage of SDLC_STAGES) {
      expect(completedStages.has(stage), `the projection must show ${stage} complete`).toBe(true);
    }

    // A refresh performs the same read; the persisted truth does not shift.
    const second = await listRunsAs(ownerId);
    const again = second.find((row) => row.graph_run_id === run!.graph_run_id);
    expect(again).toEqual(run);
  });

  it("refuses a signed-in outsider outright", async () => {
    await expect(listRunsAs(outsiderId)).rejects.toThrow(/organization membership is required/);
    await reset(db);
  });
});
