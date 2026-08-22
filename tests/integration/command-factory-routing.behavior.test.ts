// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPhase1CExecutionPlan } from "@/lib/orchestration/plan";

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000fc01";
const outsiderId = "00000000-0000-4000-8000-00000000fc02";
const organizationId = "10000000-0000-4000-8000-00000000fc01";
const otherOrganizationId = "10000000-0000-4000-8000-00000000fc02";
const connectionId = "20000000-0000-4000-8000-00000000fc01";
const installationId = "30000000-0000-4000-8000-00000000fc01";
const repositoryId = "50000000-0000-4000-8000-00000000fc01";
const emptyProjectId = "40000000-0000-4000-8000-00000000fc02";
const reauthAccountId = "60000000-0000-4000-8000-00000000fc01";
const externalInstallationId = 770_041;
const externalRepositoryId = 990_041;
const acceptanceCriteria = ["The fake feature is implemented and covered by a test."];
const securityPrompt =
  "Harden authentication and authorization so credentials and API tokens stay protected.";

type Candidate = {
  project_pipeline_id: string;
  pipeline_template_key: string;
  assignment_id: string;
  bot_id: string;
  role_id: string;
  role_risk_ceiling: string;
  assignment_status: string;
  is_configured: boolean;
  current_readiness: string;
  provider: string;
  model: string;
  assignment_model: string | null;
  assignment_config: Record<string, unknown>;
  assigned_pipeline_keys: string[];
  in_flight: number;
  max_concurrent_tasks: number;
  has_capacity: boolean;
};

type Submission = {
  command_id: string;
  task_id: string;
  command_state: string;
  task_state: string;
  requires_owner_approval: boolean;
  was_created: boolean;
  route_id: string;
  project_pipeline_id: string;
  pipeline_template_key: string;
  assignment_id: string;
  bot_id: string;
  role_id: string;
  routing_snapshot: Record<string, unknown>;
};

type Replay = Submission & {
  command_parameters: Record<string, unknown>;
  repository_full_name: string | null;
};

describe("durable command to factory routing", () => {
  let db: PGlite;
  let projectId = "";
  let primarySelectionId = "";
  let secondSelectionId = "";
  let assignmentId = "";
  let botId = "";
  let roleId = "";
  let firstSubmission: Submission;

  async function asUser(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function asOwner() {
    await asUser(ownerId);
  }

  async function asOutsider() {
    await asUser(outsiderId);
  }

  async function asSuperuser() {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }

  async function markBotReady(targetBotId: string, detail: string) {
    const { rows } = await db.query<{
      ai_account_id: string | null;
      base_url: string | null;
      credential_ref: string | null;
      model: string;
      provider: string;
      revision: number;
    }>(`
      select ai_account_id, base_url, credential_ref, model, provider::text, revision
      from public.bots where id = $1::uuid and organization_id = $2::uuid
    `, [targetBotId, organizationId]);
    const bot = rows[0];
    await db.exec("reset role");
    await db.exec("set role service_role");
    try {
      await db.query(`
        select id from public.record_bot_readiness_preserving_disabled(
          $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid,
          $6::public.bot_provider, $7::text, $8::text, $9::text,
          'ready'::public.bot_readiness, $10::text
        )
      `, [
        organizationId,
        targetBotId,
        ownerId,
        Number(bot.revision),
        bot.ai_account_id,
        bot.provider,
        bot.model,
        bot.credential_ref,
        bot.base_url,
        detail,
      ]);
    } finally {
      await asOwner();
    }
  }

  function commandParameters() {
    const plan = createPhase1CExecutionPlan("build_feature", {});
    return JSON.stringify({
      acceptanceCriteria,
      agentRole: plan.agentRole,
      budget: plan.budget,
      commandType: "build_feature",
      dependencyTaskIds: [],
      executionMode: "manual",
      model: plan.model,
      plan: plan.plan,
      provider: plan.provider,
      repositoryBinding: {
        appId: 4_582_606,
        baseBranch: "main",
        baseSha: "0123456789abcdef0123456789abcdef01234567",
        connectionId,
        externalInstallationId,
        externalRepositoryId,
        installationId,
        repositoryId,
      },
      riskAssessment: { factors: [], reasons: [], requestedRisk: "green" },
    });
  }

  async function submit(
    selectionId: string,
    selectedAssignmentId: string,
    idempotencyKey: string,
    prompt = "Build the fake routed feature and open a draft pull request.",
  ) {
    return db.query<Submission>(
      `select * from public.submit_factory_command(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
         'green'::public.risk_level, $6::jsonb, $7::text
       )`,
      [
        organizationId,
        projectId,
        selectionId,
        selectedAssignmentId,
        prompt,
        commandParameters(),
        idempotencyKey,
      ],
    );
  }

  async function resolveReplay(overrides: {
    organizationId?: string;
    projectId?: string;
    pipelineTemplateKey?: string;
    prompt?: string;
    requestedRisk?: "green" | "yellow" | "red";
    commandType?: string;
    acceptanceCriteria?: string[];
    dependencyTaskIds?: string[];
    idempotencyKey?: string;
  } = {}) {
    return db.query<Replay>(
      `select * from public.resolve_factory_command_replay(
         $1::uuid, $2::uuid, $3::text, $4::text, $5::public.risk_level,
         $6::text, $7::jsonb, $8::jsonb, $9::text
       )`,
      [
        overrides.organizationId ?? organizationId,
        overrides.projectId ?? projectId,
        overrides.pipelineTemplateKey ?? "production_readiness",
        overrides.prompt ?? securityPrompt,
        overrides.requestedRisk ?? "green",
        overrides.commandType ?? "build_feature",
        JSON.stringify(overrides.acceptanceCriteria ?? acceptanceCriteria),
        JSON.stringify(overrides.dependencyTaskIds ?? []),
        overrides.idempotencyKey ?? "factory-route-idem-1",
      ],
    );
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid()
      returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt()
      returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Factory Route Tenant', 'factory-route-tenant', '${ownerId}'),
        ('${otherOrganizationId}', 'Other Route Tenant', 'other-route-tenant', '${outsiderId}');
      insert into public.connections (
        id, organization_id, name, provider, status,
        external_account_label, secret_reference, created_by
      ) values (
        '${connectionId}', '${organizationId}', 'GitHub', 'github', 'connected',
        'fake-owner', 'env://GITHUB_APP', '${ownerId}'
      );
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id, app_slug,
        account_id, account_login, account_type, target_type, repository_selection,
        status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}', ${externalInstallationId},
        4582606, 'factory-route-app', 991041, 'fake-owner', 'User', 'User',
        'selected', 'active', now(), '${ownerId}'
      );
      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id, owner_login, name,
        full_name, default_branch, html_url, private, visibility, selected, github_updated_at
      ) values (
        '${repositoryId}', '${organizationId}', '${installationId}', ${externalRepositoryId},
        'fake-owner', 'routing', 'fake-owner/routing', 'main',
        'https://github.com/fake-owner/routing', true, 'private', true, now()
      );
      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch, created_by
      ) values (
        '${emptyProjectId}', '${organizationId}', 'Empty Roster', 'active',
        'fake-owner/empty', 'main', '${ownerId}'
      );
    `);

    await asOwner();
    const connected = await db.query<{ project_id: string }>(
      `select project_id from public.connect_github_project(
         $1::uuid, $2::uuid, $3::bigint, 'Routed Factory',
         'Synthetic routing contract project.', 'main'
       )`,
      [organizationId, connectionId, externalRepositoryId],
    );
    projectId = connected.rows[0].project_id;

    const firstSelection = await db.query<{ pipeline_id: string }>(
      "select pipeline_id from public.select_project_pipeline($1, $2, 'production_readiness')",
      [organizationId, projectId],
    );
    primarySelectionId = firstSelection.rows[0].pipeline_id;
    const secondSelection = await db.query<{ pipeline_id: string }>(
      "select pipeline_id from public.select_project_pipeline($1, $2, 'security_audit')",
      [organizationId, projectId],
    );
    secondSelectionId = secondSelection.rows[0].pipeline_id;
    await db.query(
      "select * from public.select_project_pipeline($1, $2, 'production_readiness')",
      [organizationId, emptyProjectId],
    );

    const bot = await db.query<{ id: string }>(
      `select id from public.register_bot(
         $1::uuid, 'Synthetic Routing Bot', 'openai'::public.bot_provider,
         'gpt-5.3-codex', 'OPENAI_API_KEY', null, 'Fake routing evidence bot.'
       )`,
      [organizationId],
    );
    botId = bot.rows[0].id;
    await markBotReady(botId, "Synthetic check passed.");

    const role = await db.query<{ id: string }>(
      `select id from public.save_bot_role(
         $1::uuid, null, 'Synthetic Builder', 'synthetic-builder',
         'Builds only the test fixture.', 'Open a draft pull request.',
         'red'::public.risk_level, '["build","test"]'::jsonb
       )`,
      [organizationId],
    );
    roleId = role.rows[0].id;

    const assignment = await db.query<{ id: string }>(
      `select id from public.assign_bots_to_project_checked($1::uuid, $2::uuid, $3::jsonb)`,
      [organizationId, projectId, JSON.stringify([{
        bot_id: botId,
        role_id: roleId,
        preset: "developer",
        responsibilities: ["Build the selected pipeline work"],
        repository_access: "write",
        can_open_pull_request: true,
        pipeline_access: "assigned",
        requires_human_approval: true,
        max_concurrent_tasks: 1,
        priority: 1,
        expected_assignment_id: null,
        expected_project_id: null,
        expected_revision: null,
      }])],
    );
    assignmentId = assignment.rows[0].id;
  }, 240_000);

  afterAll(async () => {
    await db.close();
  });

  it("projects the selected pipeline and canonical assignment candidate without table grants", async () => {
    const result = await db.query<Candidate>(
      "select * from public.list_factory_command_routing_candidates($1, $2, $3)",
      [organizationId, projectId, "production_readiness"],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      project_pipeline_id: primarySelectionId,
      pipeline_template_key: "production_readiness",
      assignment_id: assignmentId,
      bot_id: botId,
      role_id: roleId,
      role_risk_ceiling: "red",
      assignment_status: "active",
      is_configured: true,
      current_readiness: "ready",
      provider: "openai",
      model: "gpt-5.3-codex",
      assignment_model: null,
      in_flight: 0,
      max_concurrent_tasks: 1,
      has_capacity: true,
    });
    expect(result.rows[0].assignment_config).toMatchObject({
      repositoryAccess: "write",
      canOpenPullRequest: true,
      pipelineAccess: "assigned",
    });
    expect(result.rows[0].assigned_pipeline_keys).toEqual([
      "production_readiness",
      "security_audit",
    ]);
  });

  it("treats whitespace-only instructions as the unconfigured default", async () => {
    await asSuperuser();
    await db.query(
      `update public.bot_assignments
       set preset = null,
           responsibilities = '[]'::jsonb,
           instructions = '   ',
           repository_access = 'read',
           branch_strategy = 'per_task_branch',
           can_open_pull_request = false,
           can_merge_pull_request = false,
           pipeline_access = 'none',
           environment_access = 'none',
           tools = '[]'::jsonb,
           requires_human_approval = true,
           max_concurrent_tasks = 1,
           priority = 2,
           model = null,
           work_effort = 'medium'
       where id = $1`,
      [assignmentId],
    );

    try {
      await asOwner();
      const candidates = await db.query<Candidate>(
        "select * from public.list_factory_command_routing_candidates($1, $2, $3)",
        [organizationId, projectId, "production_readiness"],
      );
      expect(candidates.rows.find((row) => row.assignment_id === assignmentId)?.is_configured)
        .toBe(false);
      await expect(
        submit(primarySelectionId, assignmentId, "factory-whitespace-default"),
      ).rejects.toThrow(/selected bot assignment is not configured/i);
    } finally {
      await asSuperuser();
      await db.query(
        `update public.bot_assignments
         set preset = 'developer',
             responsibilities = '["Build the selected pipeline work"]'::jsonb,
             instructions = null,
             repository_access = 'write',
             branch_strategy = 'per_task_branch',
             can_open_pull_request = true,
             can_merge_pull_request = false,
             pipeline_access = 'assigned',
             environment_access = 'none',
             tools = '[]'::jsonb,
             requires_human_approval = true,
             max_concurrent_tasks = 1,
             priority = 1,
             model = null,
             work_effort = 'medium'
         where id = $1`,
        [assignmentId],
      );
      await asOwner();
    }
  });

  it("distinguishes a selected pipeline with no roster from an unselected pipeline", async () => {
    const empty = await db.query<Candidate>(
      "select * from public.list_factory_command_routing_candidates($1, $2, $3)",
      [organizationId, emptyProjectId, "production_readiness"],
    );
    expect(empty.rows).toEqual([]);
    await expect(
      db.query(
        "select * from public.list_factory_command_routing_candidates($1, $2, 'not_selected')",
        [organizationId, projectId],
      ),
    ).rejects.toThrow(/selected project pipeline was not found/i);
  });

  it("does not disclose candidates across the tenant boundary", async () => {
    await asOutsider();
    await expect(
      db.query(
        "select * from public.list_factory_command_routing_candidates($1, $2, $3)",
        [organizationId, projectId, "production_readiness"],
      ),
    ).rejects.toThrow(/organization membership is required/i);
    await expect(db.query("select * from public.factory_command_routes")).rejects.toThrow(
      /permission denied/i,
    );
    await asOwner();
  });

  it("refuses a selection or assignment outside the exact tenant/project pair", async () => {
    await expect(
      submit(
        "aaaaaaaa-0000-4000-8000-00000000fc01",
        assignmentId,
        "factory-invalid-selection",
      ),
    ).rejects.toThrow(/selected project pipeline was not found/i);
    await expect(
      submit(
        primarySelectionId,
        "bbbbbbbb-0000-4000-8000-00000000fc01",
        "factory-invalid-assignment",
      ),
    ).rejects.toThrow(/selected bot assignment is not active for this project/i);
  });

  it("rolls back a policy-raised RED command when the selected role ceiling is lower", async () => {
    try {
      for (const ceiling of ["green", "yellow"] as const) {
        await asSuperuser();
        await db.query(
          "update public.bot_roles set risk_ceiling = $1::public.risk_level where id = $2",
          [ceiling, roleId],
        );
        await asOwner();

        await expect(
          submit(primarySelectionId, assignmentId, "factory-route-idem-1", securityPrompt),
        ).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/selected bot role risk ceiling is too low/i),
        });

        await asSuperuser();
        const counts = await db.query<{
          command_count: number;
          task_count: number;
          run_count: number;
          route_count: number;
        }>(
          `select
             (select count(*)::integer from public.commands where project_id = $1) as command_count,
             (select count(*)::integer from public.tasks where project_id = $1) as task_count,
             (select count(*)::integer from public.agent_runs where project_id = $1) as run_count,
             (select count(*)::integer from public.factory_command_routes where project_id = $1) as route_count`,
          [projectId],
        );
        expect(counts.rows[0]).toEqual({
          command_count: 0,
          task_count: 0,
          run_count: 0,
          route_count: 0,
        });
      }
    } finally {
      await asSuperuser();
      await db.query(
        "update public.bot_roles set risk_ceiling = 'red'::public.risk_level where id = $1",
        [roleId],
      );
      await asOwner();
    }
  });

  it("routes a policy-raised RED command only through an adequate RED role", async () => {
    const submitted = await submit(
      primarySelectionId,
      assignmentId,
      "factory-route-idem-1",
      securityPrompt,
    );
    expect(submitted.rows).toHaveLength(1);
    firstSubmission = submitted.rows[0];
    expect(firstSubmission).toMatchObject({
      was_created: true,
      command_state: "awaiting_approval",
      task_state: "awaiting_approval",
      requires_owner_approval: true,
      project_pipeline_id: primarySelectionId,
      pipeline_template_key: "production_readiness",
      assignment_id: assignmentId,
      bot_id: botId,
      role_id: roleId,
    });
    expect(firstSubmission.command_id).toBeTruthy();
    expect(firstSubmission.task_id).toBeTruthy();
    expect(firstSubmission.route_id).toBeTruthy();
    expect(firstSubmission.routing_snapshot).toMatchObject({
      schemaVersion: 1,
      command: { effectiveRisk: "red" },
      project: { organizationId, projectId },
      pipeline: {
        selectionId: primarySelectionId,
        templateKey: "production_readiness",
        templateId: null,
      },
      assignment: {
        assignmentId,
        botId,
        roleId,
        provider: "openai",
        model: "gpt-5.3-codex",
        currentReadiness: "ready",
        roleRiskCeiling: "red",
        config: {
          repositoryAccess: "write",
          canOpenPullRequest: true,
          pipelineAccess: "assigned",
        },
      },
    });

    await asSuperuser();
    const command = await db.query<{ requested_risk: string }>(
      "select requested_risk from public.commands where id = $1",
      [firstSubmission.command_id],
    );
    expect(command.rows[0].requested_risk).toBe("red");
    await asOwner();
  });

  it("replays the same immutable route before capacity and conflicts on a changed route", async () => {
    const replayed = await submit(
      primarySelectionId,
      assignmentId,
      "factory-route-idem-1",
      securityPrompt,
    );
    expect(replayed.rows[0]).toMatchObject({
      command_id: firstSubmission.command_id,
      route_id: firstSubmission.route_id,
      was_created: false,
    });

    await expect(
      submit(secondSelectionId, assignmentId, "factory-route-idem-1", securityPrompt),
    ).rejects.toThrow(/idempotent factory command routing evidence conflicts/i);
  });

  it("resolves the original route when it is full and another bot is now available", async () => {
    const alternateBot = await db.query<{ id: string }>(
      `select id from public.register_bot(
         $1::uuid, 'Alternate Replay Bot', 'openai'::public.bot_provider,
         'gpt-5.3-codex', 'OPENAI_API_KEY', null, 'Available only after the original route.'
       )`,
      [organizationId],
    );
    await markBotReady(alternateBot.rows[0].id, "Alternate check passed.");
    const alternateAssignment = await db.query<{ id: string }>(
      "select id from public.assign_bots_to_project_checked($1::uuid, $2::uuid, $3::jsonb)",
      [organizationId, projectId, JSON.stringify([{
        bot_id: alternateBot.rows[0].id,
        role_id: roleId,
        preset: "developer",
        responsibilities: ["Handle later selected pipeline work"],
        repository_access: "write",
        can_open_pull_request: true,
        pipeline_access: "assigned",
        requires_human_approval: true,
        max_concurrent_tasks: 1,
        priority: 3,
        expected_assignment_id: null,
        expected_project_id: null,
        expected_revision: null,
      }])],
    );

    const candidates = await db.query<Candidate>(
      "select * from public.list_factory_command_routing_candidates($1, $2, $3)",
      [organizationId, projectId, "production_readiness"],
    );
    expect(candidates.rows.find((row) => row.assignment_id === assignmentId)).toMatchObject({
      in_flight: 1,
      has_capacity: false,
    });
    expect(candidates.rows.find((row) => row.assignment_id === alternateAssignment.rows[0].id))
      .toMatchObject({ in_flight: 0, has_capacity: true });

    const resolved = await resolveReplay();
    expect(resolved.rows).toHaveLength(1);
    expect(resolved.rows[0]).toMatchObject({
      command_id: firstSubmission.command_id,
      task_id: firstSubmission.task_id,
      route_id: firstSubmission.route_id,
      assignment_id: assignmentId,
      was_created: false,
      repository_full_name: "fake-owner/routing",
      command_parameters: {
        acceptanceCriteria,
        commandType: "build_feature",
        dependencyTaskIds: [],
        riskAssessment: { requestedRisk: "green", effectiveRisk: "red" },
      },
      routing_snapshot: firstSubmission.routing_snapshot,
    });
  });

  it("resolves replay after the repository base state changes", async () => {
    await asSuperuser();
    await db.query(
      "update public.github_repositories set default_branch = 'develop' where id = $1",
      [repositoryId],
    );
    try {
      await asOwner();
      const resolved = await resolveReplay();
      expect(resolved.rows[0]).toMatchObject({
        command_id: firstSubmission.command_id,
        route_id: firstSubmission.route_id,
        repository_full_name: "fake-owner/routing",
        command_parameters: {
          repositoryBinding: {
            baseBranch: "main",
            baseSha: "0123456789abcdef0123456789abcdef01234567",
          },
        },
      });
    } finally {
      await asSuperuser();
      await db.query(
        "update public.github_repositories set default_branch = 'main' where id = $1",
        [repositoryId],
      );
      await asOwner();
    }
  });

  it("rejects conflicting prompt, pipeline, risk, criteria, or dependencies", async () => {
    for (const conflict of [
      { prompt: `${securityPrompt} Change the intent.` },
      { pipelineTemplateKey: "security_audit" },
      { requestedRisk: "yellow" as const },
      { acceptanceCriteria: ["A different bounded acceptance criterion is satisfied."] },
      { dependencyTaskIds: [firstSubmission.task_id] },
    ]) {
      await expect(resolveReplay(conflict)).rejects.toMatchObject({
        code: "22023",
        message: expect.stringMatching(
          /idempotency key was already used for a different factory command intent/i,
        ),
      });
    }
  });

  it("does not enumerate another caller, project, or tenant's idempotency key", async () => {
    await asSuperuser();
    await db.query(
      `insert into public.organization_members (organization_id, user_id, role, created_by)
       values ($1, $2, 'owner'::public.organization_member_role, $3)`,
      [organizationId, outsiderId, ownerId],
    );
    try {
      await asOutsider();
      expect((await resolveReplay()).rows).toEqual([]);
      expect((await resolveReplay({
        organizationId: otherOrganizationId,
        projectId,
      })).rows).toEqual([]);

      await asOwner();
      expect((await resolveReplay({ projectId: emptyProjectId })).rows).toEqual([]);
    } finally {
      await asSuperuser();
      await db.query(
        "delete from public.organization_members where organization_id = $1 and user_id = $2",
        [organizationId, outsiderId],
      );
      await asOwner();
    }
  });

  it("counts awaiting or queued routes and rolls a new command back at capacity", async () => {
    const candidates = await db.query<Candidate>(
      "select * from public.list_factory_command_routing_candidates($1, $2, $3)",
      [organizationId, projectId, "production_readiness"],
    );
    expect(candidates.rows[0]).toMatchObject({ in_flight: 1, has_capacity: false });

    await expect(
      submit(primarySelectionId, assignmentId, "factory-route-idem-2", "Build a second fake feature."),
    ).rejects.toThrow(/selected bot assignment is at its concurrency limit/i);

    await asSuperuser();
    const commands = await db.query<{ total: number }>(
      "select count(*)::integer as total from public.commands where organization_id = $1",
      [organizationId],
    );
    expect(commands.rows[0].total).toBe(1);
    await asOwner();
  });

  it("treats an account needing reauthentication as configuration-only, never executable", async () => {
    await asSuperuser();
    await db.query(
      `insert into public.ai_accounts (
         id, organization_id, provider, auth_method, display_name,
         status, credential_purpose, created_by
       ) values ($1, $2, 'openai', 'subscription', 'Needs Sign-in Again',
                 'needs_reauth', 'codex_2', $3)`,
      [reauthAccountId, organizationId, ownerId],
    );
    await db.query(`
      update public.bots
      set ai_account_id = $1,
          credential_ref = 'SOFTWAREFACTORY_CODEX_AUTH_JSON_2'
      where id = $2
    `, [
      reauthAccountId,
      botId,
    ]);
    await asOwner();

    const candidates = await db.query<Candidate>(
      "select * from public.list_factory_command_routing_candidates($1, $2, $3)",
      [organizationId, projectId, "production_readiness"],
    );
    expect(candidates.rows[0]).toMatchObject({
      ai_account_status: "needs_reauth",
      current_readiness: "not_connected",
    });
    await expect(
      submit(primarySelectionId, assignmentId, "factory-reauth-idem-1"),
    ).rejects.toThrow(/selected bot is not ready/i);

    await asSuperuser();
    await db.query(`
      update public.bots
      set ai_account_id = null,
          credential_ref = 'OPENAI_API_KEY'
      where id = $1
    `, [botId]);
    await db.query("delete from public.ai_accounts where id = $1", [reauthAccountId]);
    await asOwner();
  });

  it("never fabricates routing evidence for a legacy idempotent command", async () => {
    await db.query(
      `select * from public.submit_command(
         $1::uuid, 'A pre-routing command.', 'green'::public.risk_level,
         $2::jsonb, 'factory-legacy-idem-1'
       )`,
      [projectId, commandParameters()],
    );
    await expect(resolveReplay({
      prompt: "A pre-routing command.",
      idempotencyKey: "factory-legacy-idem-1",
    })).rejects.toMatchObject({
      code: "22023",
      message: expect.stringMatching(/idempotent command predates factory routing evidence/i),
    });
    await expect(
      submit(
        primarySelectionId,
        assignmentId,
        "factory-legacy-idem-1",
        "A pre-routing command.",
      ),
    ).rejects.toThrow(/idempotent command predates factory routing evidence/i);

    await asSuperuser();
    const routes = await db.query<{ total: number }>(
      `select count(*)::integer as total
       from public.factory_command_routes route
       join public.commands command on command.id = route.command_id
       where command.idempotency_key = 'factory-legacy-idem-1'`,
    );
    expect(routes.rows[0].total).toBe(0);
    await asOwner();
  });

  it("keeps worker registration and every autonomy interlock unchanged", async () => {
    await asSuperuser();
    const controls = await db.query<{
      autonomy_kill_switch_active: boolean;
      autonomous_mode: boolean;
      auto_plan: boolean;
      auto_code: boolean;
      auto_test: boolean;
      auto_repair: boolean;
      auto_review: boolean;
      auto_approve: boolean;
      auto_merge: boolean;
      auto_deploy: boolean;
      auto_rollback: boolean;
    }>(
      `select autonomy_kill_switch_active, autonomous_mode,
              auto_plan, auto_code, auto_test, auto_repair, auto_review,
              auto_approve, auto_merge, auto_deploy, auto_rollback
       from public.organizations where id = $1`,
      [organizationId],
    );
    expect(controls.rows[0]).toEqual({
      autonomy_kill_switch_active: true,
      autonomous_mode: false,
      auto_plan: false,
      auto_code: false,
      auto_test: false,
      auto_repair: false,
      auto_review: false,
      auto_approve: false,
      auto_merge: false,
      auto_deploy: false,
      auto_rollback: false,
    });
    const workers = await db.query<{ total: number }>(
      "select count(*)::integer as total from public.phase1c_workers",
    );
    expect(workers.rows[0].total).toBe(0);
    await expect(
      db.query("select * from public.claim_phase1c_run('missing-worker', 'openai', 'gpt-5.3-codex', 120)"),
    ).rejects.toThrow(/worker is not registered and active/i);
    await asOwner();
  });

  it("refuses privileged mutation of route evidence", async () => {
    await asSuperuser();
    await expect(
      db.query(
        "update public.factory_command_routes set role_id = $1 where id = $2",
        ["cccccccc-0000-4000-8000-00000000fc01", firstSubmission.route_id],
      ),
    ).rejects.toThrow(/factory command routing evidence is immutable/i);
    await expect(
      db.query("delete from public.factory_command_routes where id = $1", [firstSubmission.route_id]),
    ).rejects.toThrow(/factory command routing evidence is immutable/i);
    await asOwner();
  });

  it("lets the mutable pipeline be deselected without erasing historical routing", async () => {
    await db.query(
      "select * from public.deselect_project_pipeline($1, $2, 'production_readiness')",
      [organizationId, projectId],
    );
    await asSuperuser();
    const kept = await db.query<{ total: number }>(
      "select count(*)::integer as total from public.factory_command_routes where id = $1",
      [firstSubmission.route_id],
    );
    expect(kept.rows[0].total).toBe(1);
    await asOwner();
  });
});
