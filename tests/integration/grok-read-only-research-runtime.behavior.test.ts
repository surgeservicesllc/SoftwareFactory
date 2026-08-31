// @vitest-environment node

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildGrokChiefOfStaffPlan,
  type GrokConfiguredAgent,
} from "@/lib/factory/chief-of-staff";
import { buildGrokReadOnlyIntentAdmissions } from "@/lib/grok/provider-admission";
import { createMigratedDatabase } from "@/tests/support/migrated-database";

const ownerId = "01000000-0000-4000-8000-000000000001";
const organizationId = "02000000-0000-4000-8000-000000000002";
const projectId = "03000000-0000-4000-8000-000000000003";
const accountId = "04000000-0000-4000-8000-000000000004";
const botId = "05000000-0000-4000-8000-000000000005";
const roleId = "06000000-0000-4000-8000-000000000006";
const assignmentId = "07000000-0000-4000-8000-000000000007";
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

describe("Grok read-only research runtime behavior", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id, email) values
        ('${ownerId}', 'research-owner@example.test');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Research Runtime Co', 'research-runtime-co', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role) values
        ('${organizationId}', '${ownerId}', 'owner')
      on conflict (organization_id, user_id) do update set role = excluded.role;
      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch, created_by
      ) values (
        '${projectId}', '${organizationId}', 'Research Runtime', 'active',
        'factory/research-runtime', 'main', '${ownerId}'
      );
      insert into public.ai_accounts (
        id, organization_id, provider, auth_method, display_name, status,
        credential_purpose, provider_identity, created_by
      ) values (
        '${accountId}', '${organizationId}', 'anthropic', 'subscription',
        'Research Claude', 'connected', 'claude_17', 'research-owner', '${ownerId}'
      );
      insert into public.provider_credentials (
        organization_id, purpose, sealed_envelope, source, created_by
      ) values (
        '${organizationId}', 'claude_17',
        'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'connect_session', '${ownerId}'
      );
      insert into public.bot_roles (
        id, organization_id, name, slug, summary, instructions,
        risk_ceiling, capabilities, created_by
      ) values (
        '${roleId}', '${organizationId}', 'Research generalist', 'research-generalist',
        'Read-only research and verification', 'Inspect and report bounded evidence only.',
        'red', '${JSON.stringify(capabilities)}'::jsonb, '${ownerId}'
      );
      insert into public.bots (
        id, organization_id, name, provider, model, credential_ref,
        readiness, last_checked_at, ai_account_id, created_by
      ) values (
        '${botId}', '${organizationId}', 'Research Claude', 'anthropic',
        'claude-opus-5', 'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_17',
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

  it("launches once, replays exactly, stays paused, and rejects unsafe manifests without residue", async () => {
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
    if (!identity) throw new Error("research posting fixture is missing");

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
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_17",
      credentialPurpose: "claude_17",
      providerIdentity: "research-owner",
      name: "Research Claude",
      provider: "anthropic",
      model: "claude-opus-5",
      capabilities,
      maxModelTier: "STRONG",
      ready: true,
      priority: 2,
    } satisfies GrokConfiguredAgent);
    const planned = buildGrokChiefOfStaffPlan({
      prompt: "Research the provider admission boundary",
      project: {
        projectId,
        name: "Research Runtime",
        repositoryFullName: "factory/research-runtime",
        defaultBranch: "main",
      },
      agents: [agent],
      intent: "research",
    });
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    if (!planned.ok) throw new Error(planned.error.message);
    expect(planned.plan.graphLaunch).toMatchObject({
      riskLevel: "green",
      requiresOwnerApproval: false,
    });
    const admissions = buildGrokReadOnlyIntentAdmissions(
      planned.plan,
      planned.plan.graphLaunch.nodes,
    );

    await assumeRole(db, "authenticated", ownerId);
    const session = await db.query<{ id: string }>(
      "select id from public.create_grok_session($1::uuid,$2::uuid,$3::text,$4::text)",
      [organizationId, projectId, planned.plan.intent.prompt, "research-session-0001"],
    );
    const sessionId = session.rows[0]!.id;
    const user = await db.query<{ id: string }>(`
      select id from public.append_grok_user_message(
        $1::uuid,$2::uuid,$3::text,'{}'::jsonb,$4::text,0,null
      )
    `, [organizationId, sessionId, planned.plan.intent.prompt, "research-user-0001"]);
    await assumeRole(db, "service_role");
    const assistant = await db.query<{ id: string }>(`
      select id from public.append_grok_message_as_server(
        $1::uuid,$2::uuid,'assistant',$3::text,$4::jsonb,$5::text,1,$6::uuid
      )
    `, [
      organizationId,
      sessionId,
      "The exact read-only research plan is recorded.",
      JSON.stringify({ kind: "grok.plan", plan: planned.plan }),
      "research-assistant-0001",
      user.rows[0]!.id,
    ]);
    const messageId = assistant.rows[0]!.id;

    const call = `select id, graph_id from public.launch_grok_read_only_research_v2_as_server(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,
      $8::public.graph_topology,$9::jsonb,$10::public.risk_level,$11::boolean,
      $12::jsonb,$13::jsonb,$14::jsonb,$15::text,$16::jsonb
    )`;
    const parameters = (options: {
      idempotencyKey: string;
      riskLevel?: string;
      requiresOwnerApproval?: boolean;
      admissions?: unknown;
    }) => [
      organizationId,
      ownerId,
      projectId,
      sessionId,
      messageId,
      options.idempotencyKey,
      planned.plan.graphLaunch.goal,
      planned.plan.graphLaunch.topology,
      JSON.stringify(planned.plan.graphLaunch.topologyReasons),
      options.riskLevel ?? planned.plan.graphLaunch.riskLevel,
      options.requiresOwnerApproval ?? planned.plan.graphLaunch.requiresOwnerApproval,
      JSON.stringify(planned.plan.graphLaunch.nodes),
      JSON.stringify(planned.plan.graphLaunch.edges),
      JSON.stringify(planned.plan.graphLaunch.budget),
      "research-roster-0001",
      JSON.stringify(options.admissions ?? admissions),
    ];

    const nullVersion = admissions.map((entry, index) => index === 0
      ? { ...entry, version: null }
      : entry);
    await expect(db.query(call, parameters({
      idempotencyKey: "research-null-version-0001",
      admissions: nullVersion,
    }))).rejects.toThrow(/invalid grok research v2 admission protocol version/i);
    await expect(db.query(call, parameters({
      idempotencyKey: "research-red-risk-0001",
      riskLevel: "red",
    }))).rejects.toThrow(/invalid grok read-only research launch input/i);
    await expect(db.query(call, parameters({
      idempotencyKey: "research-owner-approval-0001",
      requiresOwnerApproval: true,
    }))).rejects.toThrow(/invalid grok read-only research launch input/i);

    await resetRole(db);
    const rejected = await db.query<{ graphs: number; launches: number; roster: number }>(`
      select
        (select count(*)::integer from public.graphs where organization_id=$1 and goal=$2) as graphs,
        (select count(*)::integer from public.grok_graph_launches where session_id=$3) as launches,
        (select count(*)::integer from public.grok_specialist_admissions where session_id=$3) as roster
    `, [organizationId, planned.plan.graphLaunch.goal, sessionId]);
    expect(rejected.rows[0]).toEqual({ graphs: 0, launches: 0, roster: 0 });

    await assumeRole(db, "service_role");
    const acceptedParameters = parameters({ idempotencyKey: "research-launch-0001" });
    const launched = await db.query<{ id: string; graph_id: string }>(call, acceptedParameters);
    const replayed = await db.query<{ id: string; graph_id: string }>(call, acceptedParameters);
    expect(replayed.rows[0]).toEqual(launched.rows[0]);

    await resetRole(db);
    const evidence = await db.query<{
      admissions: number;
      graph_events: number;
      graph_runs: number;
      graphs: number;
      launches: number;
      pause_requested_at: string | null;
      roster: number;
      current_admissions: boolean;
    }>(`
      select
        (select count(*)::integer from public.graphs where id=$1) as graphs,
        (select count(*)::integer from public.grok_graph_launches where graph_id=$1) as launches,
        (select count(*)::integer from public.grok_specialist_admissions where session_id=$2) as roster,
        (select count(*)::integer from public.grok_execution_admissions where graph_id=$1) as admissions,
        (select count(*)::integer from public.graph_runs where graph_id=$1) as graph_runs,
        (select count(*)::integer from public.grok_events where session_id=$2 and event_type='graph.planned') as graph_events,
        (select pause_requested_at from public.graphs where id=$1) as pause_requested_at,
        public.assert_current_grok_execution_admissions($1::uuid) as current_admissions
    `, [launched.rows[0]!.graph_id, sessionId]);
    expect(evidence.rows[0]).toMatchObject({
      graphs: 1,
      launches: 1,
      roster: 1,
      admissions: admissions.length,
      graph_runs: 0,
      graph_events: 1,
      current_admissions: true,
    });
    expect(evidence.rows[0]!.pause_requested_at).not.toBeNull();
  }, 60_000);
});
