// @vitest-environment node

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildGrokChiefOfStaffPlan,
  type GrokConfiguredAgent,
} from "@/lib/factory/chief-of-staff";
import {
  buildGrokDeployReadinessAdmissions,
  buildGrokDeployReadinessProjection,
} from "@/lib/grok/provider-admission";
import { createMigratedDatabase } from "@/tests/support/migrated-database";

const ownerId = "11000000-0000-4000-8000-000000000001";
const organizationId = "12000000-0000-4000-8000-000000000002";
const projectId = "13000000-0000-4000-8000-000000000003";
const accountId = "14000000-0000-4000-8000-000000000004";
const botId = "15000000-0000-4000-8000-000000000005";
const roleId = "16000000-0000-4000-8000-000000000006";
const assignmentId = "17000000-0000-4000-8000-000000000007";
const capabilities = Object.freeze(["*"] as const);

type ApplicationRole = "authenticated" | "service_role";

async function assumeRole(db: PGlite, role: ApplicationRole, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', $2::text)::text, false)",
    [userId ?? "", role],
  );
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("select set_config('request.jwt.claims', '{}', false)");
}

describe("Grok deploy-readiness runtime behavior", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id, email) values
        ('${ownerId}', 'deploy-readiness-owner@example.test');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Deploy Readiness Co', 'deploy-readiness-co', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role) values
        ('${organizationId}', '${ownerId}', 'owner')
      on conflict (organization_id, user_id) do update set role = excluded.role;
      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch, created_by
      ) values (
        '${projectId}', '${organizationId}', 'Deploy Readiness', 'active',
        'factory/deploy-readiness', 'main', '${ownerId}'
      );
      insert into public.ai_accounts (
        id, organization_id, provider, auth_method, display_name, status,
        credential_purpose, provider_identity, created_by
      ) values (
        '${accountId}', '${organizationId}', 'anthropic', 'subscription',
        'Readiness Claude', 'connected', 'claude_18', 'deploy-owner', '${ownerId}'
      );
      insert into public.provider_credentials (
        organization_id, purpose, sealed_envelope, source, created_by
      ) values (
        '${organizationId}', 'claude_18',
        'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'connect_session', '${ownerId}'
      );
      insert into public.bot_roles (
        id, organization_id, name, slug, summary, instructions,
        risk_ceiling, capabilities, created_by
      ) values (
        '${roleId}', '${organizationId}', 'Release inspector', 'release-inspector',
        'Read-only release evidence inspection', 'Inspect and report bounded evidence only.',
        'red', '${JSON.stringify(capabilities)}'::jsonb, '${ownerId}'
      );
      insert into public.bots (
        id, organization_id, name, provider, model, credential_ref,
        readiness, last_checked_at, ai_account_id, created_by
      ) values (
        '${botId}', '${organizationId}', 'Readiness Claude', 'anthropic',
        'claude-opus-5', 'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_18',
        'ready', now(), '${accountId}', '${ownerId}'
      );
      insert into public.bot_assignments (
        id, organization_id, bot_id, project_id, role_id, status,
        preset, model, work_effort, repository_access, can_open_pull_request,
        can_merge_pull_request, pipeline_access, requires_human_approval, created_by
      ) values (
        '${assignmentId}', '${organizationId}', '${botId}', '${projectId}', '${roleId}',
        'active', 'reviewer', 'claude-opus-5', 'high', 'read', false, false,
        'all', true, '${ownerId}'
      );
    `);
  }, 180_000);

  afterAll(async () => {
    await db?.close();
  });

  it("projects RED intent to one durable resource-free GREEN graph and rejects widening without residue", async () => {
    const snapshot = await db.query<{
      assignment_revision: number;
      bot_revision: number;
      role_updated_at: string | Date;
      account_updated_at: string | Date;
    }>(`
      select assignment.revision as assignment_revision,
             bot.revision as bot_revision,
             role_definition.updated_at as role_updated_at,
             account.updated_at as account_updated_at
        from public.bot_assignments assignment
        join public.bots bot on bot.id = assignment.bot_id
        join public.bot_roles role_definition on role_definition.id = assignment.role_id
        join public.ai_accounts account on account.id = bot.ai_account_id
       where assignment.id = $1
    `, [assignmentId]);
    const identity = snapshot.rows[0];
    if (!identity) throw new Error("deploy-readiness posting fixture is missing");

    const agent = Object.freeze({
      id: assignmentId,
      assignmentId,
      assignmentRevision: Number(identity.assignment_revision),
      botId,
      botRevision: Number(identity.bot_revision),
      roleId,
      roleUpdatedAt: new Date(identity.role_updated_at).toISOString(),
      aiAccountId: accountId,
      accountUpdatedAt: new Date(identity.account_updated_at).toISOString(),
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_18",
      credentialPurpose: "claude_18",
      providerIdentity: "deploy-owner",
      name: "Readiness Claude",
      provider: "anthropic",
      model: "claude-opus-5",
      capabilities,
      maxModelTier: "STRONG",
      ready: true,
      priority: 2,
    } satisfies GrokConfiguredAgent);
    const planned = buildGrokChiefOfStaffPlan({
      prompt: "Deploy the current exact release",
      project: {
        projectId,
        name: "Deploy Readiness",
        repositoryFullName: "factory/deploy-readiness",
        defaultBranch: "main",
      },
      agents: [agent],
      intent: "deploy",
    });
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    if (!planned.ok) throw new Error(planned.error.message);
    const readiness = buildGrokDeployReadinessProjection(planned.plan);
    const admissions = buildGrokDeployReadinessAdmissions(planned.plan, readiness.nodes);
    expect(planned.plan.intent.risk).toBe("RED");
    expect(readiness).toMatchObject({ riskLevel: "green", requiresOwnerApproval: false });

    await assumeRole(db, "authenticated", ownerId);
    const session = await db.query<{ id: string }>(
      "select id from public.create_grok_session($1::uuid,$2::uuid,$3::text,$4::text)",
      [organizationId, projectId, planned.plan.intent.prompt, "deploy-readiness-session-0001"],
    );
    const sessionId = session.rows[0]!.id;
    const user = await db.query<{ id: string }>(`
      select id from public.append_grok_user_message(
        $1::uuid,$2::uuid,$3::text,'{}'::jsonb,$4::text,0,null
      )
    `, [organizationId, sessionId, planned.plan.intent.prompt, "deploy-readiness-user-0001"]);
    await assumeRole(db, "service_role");
    const assistant = await db.query<{ id: string }>(`
      select id from public.append_grok_message_as_server(
        $1::uuid,$2::uuid,'assistant',$3::text,$4::jsonb,$5::text,1,$6::uuid
      )
    `, [
      organizationId,
      sessionId,
      "I recorded a deterministic deploy plan with 5 tasks across 3 dependency-safe layers. Execution has not started.",
      JSON.stringify({ schemaVersion: 1, kind: "grok.plan", plan: planned.plan }),
      "deploy-readiness-assistant-0001",
      user.rows[0]!.id,
    ]);
    const messageId = assistant.rows[0]!.id;

    const call = `select id, graph_id from public.launch_grok_deploy_readiness_v1_as_server(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,
      $8::public.graph_topology,$9::jsonb,$10::public.risk_level,$11::boolean,
      $12::jsonb,$13::jsonb,$14::jsonb,$15::text,$16::jsonb
    )`;
    const parameters = (options: {
      idempotencyKey: string;
      nodes?: unknown;
      admissions?: unknown;
      riskLevel?: string;
      requiresOwnerApproval?: boolean;
      sessionId?: string;
      messageId?: string;
      rosterKey?: string;
    }) => [
      organizationId,
      ownerId,
      projectId,
      options.sessionId ?? sessionId,
      options.messageId ?? messageId,
      options.idempotencyKey,
      readiness.goal,
      readiness.topology,
      JSON.stringify(readiness.topologyReasons),
      options.riskLevel ?? readiness.riskLevel,
      options.requiresOwnerApproval ?? readiness.requiresOwnerApproval,
      JSON.stringify(options.nodes ?? readiness.nodes),
      JSON.stringify(readiness.edges),
      JSON.stringify(readiness.budget),
      options.rosterKey ?? "deploy-readiness-roster-0001",
      JSON.stringify(options.admissions ?? admissions),
    ];

    await assumeRole(db, "authenticated", ownerId);
    const tamperedSession = await db.query<{ id: string }>(
      "select id from public.create_grok_session($1::uuid,$2::uuid,$3::text,$4::text)",
      [organizationId, projectId, planned.plan.intent.prompt, "deploy-readiness-tampered-session-0001"],
    );
    const tamperedSessionId = tamperedSession.rows[0]!.id;
    const tamperedUser = await db.query<{ id: string }>(`
      select id from public.append_grok_user_message(
        $1::uuid,$2::uuid,$3::text,'{}'::jsonb,$4::text,0,null
      )
    `, [organizationId, tamperedSessionId, planned.plan.intent.prompt, "deploy-readiness-tampered-user-0001"]);
    const tamperedPlan = {
      ...planned.plan,
      graphLaunch: {
        ...planned.plan.graphLaunch,
        nodes: planned.plan.graphLaunch.nodes.map((node) => node.node_key === "inspect_release"
          ? { ...node, output_schema: { type: "object", properties: {} } }
          : node),
      },
    };
    await assumeRole(db, "service_role");
    const tamperedAssistant = await db.query<{ id: string }>(`
      select id from public.append_grok_message_as_server(
        $1::uuid,$2::uuid,'assistant',$3::text,$4::jsonb,$5::text,1,$6::uuid
      )
    `, [
      organizationId,
      tamperedSessionId,
      "I recorded a deterministic deploy plan with 5 tasks across 3 dependency-safe layers. Execution has not started.",
      JSON.stringify({ schemaVersion: 1, kind: "grok.plan", plan: tamperedPlan }),
      "deploy-readiness-tampered-assistant-0001",
      tamperedUser.rows[0]!.id,
    ]);
    await expect(db.query(call, parameters({
      idempotencyKey: "deploy-readiness-tampered-schema",
      sessionId: tamperedSessionId,
      messageId: tamperedAssistant.rows[0]!.id,
      rosterKey: "deploy-readiness-tampered-roster-0001",
    }))).rejects.toThrow(/deploy node contract is not exact/i);

    await expect(db.query(call, parameters({
      idempotencyKey: "deploy-readiness-null-version",
      admissions: admissions.map((entry, index) => index === 0 ? { ...entry, version: null } : entry),
    }))).rejects.toThrow(/invalid or duplicate grok deploy-readiness admission entry/i);
    await expect(db.query(call, parameters({
      idempotencyKey: "deploy-readiness-red-risk",
      riskLevel: "red",
    }))).rejects.toThrow(/invalid grok deploy-readiness launch input/i);
    await expect(db.query(call, parameters({
      idempotencyKey: "deploy-readiness-owner-gate",
      requiresOwnerApproval: true,
    }))).rejects.toThrow(/invalid grok deploy-readiness launch input/i);
    await expect(db.query(call, parameters({
      idempotencyKey: "deploy-readiness-resource",
      nodes: readiness.nodes.map((node, index) => index === 0
        ? { ...node, reads: [{ kind: "directory", id: "factory/deploy-readiness:read-only-snapshot" }] }
        : node),
    }))).rejects.toThrow(/exact safe projection/i);

    await resetRole(db);
    const rejected = await db.query<{ graphs: number; launches: number; roster: number }>(`
      select
        (select count(*)::integer from public.graphs where organization_id=$1 and goal=$2) as graphs,
        (select count(*)::integer from public.grok_graph_launches where session_id in ($3,$4)) as launches,
        (select count(*)::integer from public.grok_specialist_admissions where session_id in ($3,$4)) as roster
    `, [organizationId, readiness.goal, sessionId, tamperedSessionId]);
    expect(rejected.rows[0]).toEqual({ graphs: 0, launches: 0, roster: 0 });

    await assumeRole(db, "service_role");
    const acceptedParameters = parameters({ idempotencyKey: "deploy-readiness-launch-0001" });
    const launched = await db.query<{ id: string; graph_id: string }>(call, acceptedParameters);
    const replayed = await db.query<{ id: string; graph_id: string }>(call, acceptedParameters);
    expect(replayed.rows[0]).toEqual(launched.rows[0]);

    await resetRole(db);
    const evidence = await db.query<{
      admissions: number;
      gate_count: number;
      graph_events: number;
      graph_runs: number;
      node_count: number;
      resource_count: number;
      pause_requested_at: string | null;
      original_intent: string;
      original_risk: string;
      delivery_gate: string;
      projected_risk: string;
    }>(`
      select
        (select count(*)::integer from public.graph_nodes where graph_id=$1) as node_count,
        (select count(*)::integer from public.graph_gates where graph_id=$1) as gate_count,
        (select count(*)::integer from public.graph_runs where graph_id=$1) as graph_runs,
        (select count(*)::integer from public.grok_execution_admissions where graph_id=$1) as admissions,
        (select count(*)::integer
           from public.graph_nodes node
           join public.node_contracts contract on contract.node_id=node.id
          where node.graph_id=$1
            and (jsonb_array_length(contract.reads)>0 or jsonb_array_length(contract.writes)>0)) as resource_count,
        (select count(*)::integer from public.grok_events
          where session_id=$2 and event_type='graph.planned') as graph_events,
        (select pause_requested_at from public.graphs where id=$1) as pause_requested_at,
        (select metadata #>> '{plan,intent,kind}' from public.grok_messages where id=$3) as original_intent,
        (select metadata #>> '{plan,intent,risk}' from public.grok_messages where id=$3) as original_risk,
        (select metadata #>> '{plan,dag,tasks,4,gate,kind}' from public.grok_messages where id=$3) as delivery_gate,
        (select risk_level::text from public.graphs where id=$1) as projected_risk
    `, [launched.rows[0]!.graph_id, sessionId, messageId]);
    expect(evidence.rows[0]).toMatchObject({
      node_count: 4,
      gate_count: 0,
      graph_runs: 0,
      admissions: 4,
      resource_count: 0,
      graph_events: 1,
      original_intent: "deploy",
      original_risk: "RED",
      delivery_gate: "HUMAN",
      projected_risk: "green",
    });
    expect(evidence.rows[0]!.pause_requested_at).not.toBeNull();
  }, 60_000);
});
