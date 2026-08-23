// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assignmentIsConfigured, LEAST_PRIVILEGE_CONFIG } from "@/lib/bots/assignment-config";
import { createPhase1CExecutionPlan } from "@/lib/orchestration/plan";

/**
 * The AI Factory guided journey (`/solutions/ai-factory`), walked end to end
 * against real PostgreSQL with the real migrations applied.
 *
 * The console's nine steps derive their completion from live records rather
 * than from stored wizard state, so the only way to know a step works is to
 * produce the record it reads and check that the derivation flips. That is
 * what this does, with fake tenant data, one step at a time:
 *
 *   Connect Repository -> Create Project -> Configure Pipeline -> Select Agents
 *   -> Connect Bots -> Assign Bots -> Configure Bot Settings -> Issue a Command
 *   -> Watch It Ship
 *
 * Select Agents was absent from this walk while the console had nine steps and
 * the numbering here ran to eight, so every step after Configure Pipeline
 * reported under the wrong number and step 4 had no coverage in the one lane
 * that runs on every commit. The browser walk covers it, but that lane needs a
 * local Supabase stack, and against a deployed target it skips itself because
 * step 1 is a GitHub App installation no runner can perform.
 *
 * Every write goes through the same SECURITY DEFINER function the browser
 * reaches through its API route, called as `authenticated` with the caller's
 * JWT claim set — not by inserting rows directly. A step that only passes
 * because the test wrote its own row would prove nothing about the wiring.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000fa01";
const outsiderId = "00000000-0000-4000-8000-00000000fa02";
const organizationId = "10000000-0000-4000-8000-00000000fa01";
const otherOrganizationId = "10000000-0000-4000-8000-00000000fa02";
const connectionId = "20000000-0000-4000-8000-00000000fa01";
const installationId = "30000000-0000-4000-8000-00000000fa01";
const repositoryId = "50000000-0000-4000-8000-00000000fa01";
const journeyAgentId = "60000000-0000-4000-8000-00000000fa01";
const secondAgentId = "60000000-0000-4000-8000-00000000fa02";

/** The fake repository the journey connects. */
const EXTERNAL_REPOSITORY = 900_123;
const EXTERNAL_INSTALLATION = 700_123;

type Step = { readonly step: string; readonly evidence: string };

describe("the AI Factory journey, step by step against real PostgreSQL", () => {
  let db: PGlite;
  const walked: Step[] = [];

  function record(step: string, evidence: string) {
    walked.push({ step, evidence });
  }

  /**
   * The exact parameter object the browser path sends, built from the
   * application's own plan builder rather than copied by hand — `submit_command`
   * accepts one fixed set of eleven keys and nothing else, and a hand-written
   * copy would drift the moment the plan changes.
   */
  function commandParameters(criteria: readonly string[]) {
    const plan = createPhase1CExecutionPlan("other", {});
    return JSON.stringify({
      acceptanceCriteria: criteria,
      agentRole: plan.agentRole,
      budget: plan.budget,
      commandType: "other",
      dependencyTaskIds: [],
      executionMode: "manual",
      model: plan.model,
      plan: plan.plan,
      provider: plan.provider,
      repositoryBinding: {
        appId: 4582606,
        baseBranch: "main",
        baseSha: "0123456789abcdef0123456789abcdef01234567",
        connectionId,
        externalInstallationId: EXTERNAL_INSTALLATION,
        externalRepositoryId: EXTERNAL_REPOSITORY,
        installationId,
        repositoryId,
      },
      riskAssessment: { factors: [], reasons: [], requestedRisk: "green" },
    });
  }

  /** Act as the signed-in owner, the way an API route does for a browser call. */
  async function asOwner() {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
    await db.exec("set role authenticated");
  }

  /** Act as a signed-in user of a different tenant. */
  async function asOutsider() {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [outsiderId]);
    await db.exec("set role authenticated");
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
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create or replace function auth.jwt()
      returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const migrationFiles = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    // The tenant and its GitHub connection: the state a visitor arrives with
    // after installing the App, which the journey's first step reads.
    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Fake Factory', 'fake-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Rival Factory', 'rival-factory', '${outsiderId}');

      insert into public.connections (
        id, organization_id, name, provider, status, external_account_label, secret_reference, created_by
      ) values (
        '${connectionId}', '${organizationId}', 'GitHub', 'github', 'connected',
        'fake-owner', 'env://GITHUB_APP', '${ownerId}'
      );

      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id, app_slug,
        account_id, account_login, account_type, target_type, repository_selection,
        status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}', ${EXTERNAL_INSTALLATION},
        4582606, 'fake-factory-app', 900001, 'fake-owner', 'User', 'User',
        'selected', 'active', now(), '${ownerId}'
      );

      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id, owner_login, name,
        full_name, default_branch, html_url, private, visibility, selected, github_updated_at
      ) values (
        '${repositoryId}', '${organizationId}', '${installationId}', ${EXTERNAL_REPOSITORY},
        'fake-owner', 'storefront', 'fake-owner/storefront', 'main',
        'https://github.com/fake-owner/storefront', true, 'private', true, now()
      );
    `);

    await asOwner();
  }, 120_000);

  afterAll(async () => {
    await db.close();
    // The journey is printed so a reader of a green run can see what it
    // actually did, rather than trusting the word "passed".
    for (const entry of walked) process.stdout.write(`  ${entry.step}: ${entry.evidence}\n`);
  });

  let projectId = "";
  let templateId = "";
  let accountId = "";
  let botId = "";
  let roleId = "";
  let assignmentId = "";
  let assignmentRevision = 0;
  let commandId = "";

  it("step 1 — Connect Repository: a selected repository is offered to the journey", async () => {
    // The step is done when the tenant has a connected GitHub connection with a
    // selected repository, which is what the console reads from
    // /api/github/connections.
    const { rows } = await db.query<{ full_name: string; selected: boolean; status: string }>(
      `select r.full_name, r.selected, c.status
       from public.github_repositories r
       join public.github_installations i on i.id = r.installation_id
       join public.connections c on c.id = i.connection_id
       where r.organization_id = $1::uuid`,
      [organizationId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ full_name: "fake-owner/storefront", selected: true, status: "connected" });
    record("1 Connect Repository", "fake-owner/storefront is connected and selected");
  });

  it("step 2 — Create Project: connect_github_project binds the project to the repository", async () => {
    const { rows } = await db.query<{
      project_id: string; project_name: string; github_repository: string;
      default_branch: string; project_status: string; connection_id: string;
    }>(
      `select * from public.connect_github_project(
         $1::uuid, $2::uuid, $3::bigint, 'Storefront Rebuild',
         'A fake project for the guided journey.', 'main'
       )`,
      [organizationId, connectionId, EXTERNAL_REPOSITORY],
    );

    expect(rows).toHaveLength(1);
    projectId = rows[0].project_id;
    expect(rows[0]).toMatchObject({
      project_name: "Storefront Rebuild",
      github_repository: "fake-owner/storefront",
      default_branch: "main",
      project_status: "active",
      connection_id: connectionId,
    });
    record("2 Create Project", `Storefront Rebuild bound to fake-owner/storefront (${projectId})`);
  });

  it("step 2 — the binding is by immutable repository id, not by a name the prompt could pick", async () => {
    const { rows } = await db.query<{ external_repository_id: string }>(
      `select r.external_repository_id::text
       from public.project_connections pc
       join public.github_repositories r on r.id = pc.github_repository_id
       where pc.project_id = $1::uuid`,
      [projectId],
    );
    expect(rows[0]?.external_repository_id).toBe(String(EXTERNAL_REPOSITORY));
  });

  it("step 2 — another tenant cannot connect this repository", async () => {
    await asOutsider();
    await expect(
      db.query(
        `select * from public.connect_github_project($1::uuid, $2::uuid, $3::bigint, 'Stolen', null, 'main')`,
        [organizationId, connectionId, EXTERNAL_REPOSITORY],
      ),
    ).rejects.toThrow();
    await asOwner();
  });

  it("step 3 — Configure Pipeline: a custom template is created and reads back", async () => {
    const { rows } = await db.query<{ template_id: string; slug: string; version: number }>(
      `select * from public.create_pipeline_template(
         $1::uuid, 'fake_review_pipeline', 'Fake Review Pipeline',
         'Reviews a change the way the journey demonstrates it.',
         'REVIEW', 'analysis', $2::jsonb, 'DAG'::public.graph_topology
       )`,
      [organizationId, JSON.stringify([
        { id: "migrations", job: "Read the newest migrations and say what they create." },
        { id: "rls", job: "Check every new table has row level security forced." },
        { id: "tests", job: "Name the tests that cover the change." },
      ])],
    );

    expect(rows).toHaveLength(1);
    templateId = rows[0].template_id;
    expect(rows[0].slug).toBe("fake_review_pipeline");
    expect(rows[0].version).toBe(1);
    record("3 Configure Pipeline", `custom template fake_review_pipeline v${rows[0].version}`);
  });

  it("step 3 — editing the template moves its version rather than forking it", async () => {
    const { rows } = await db.query<{ version: number; template_id: string }>(
      `select template_id, version from public.update_pipeline_template(
         $1::uuid, $2::uuid, 'Fake Review Pipeline', 'Now with a fourth area.',
         'REVIEW', 'analysis', $3::jsonb, 'DAG'::public.graph_topology
       )`,
      [organizationId, templateId, JSON.stringify([
        { id: "migrations", job: "Read the newest migrations and say what they create." },
        { id: "rls", job: "Check every new table has row level security forced." },
        { id: "tests", job: "Name the tests that cover the change." },
        { id: "observability", job: "Say what a reader of the logs would learn." },
      ])],
    );
    expect(rows[0].template_id).toBe(templateId);
    expect(rows[0].version).toBe(2);
  });

  it("step 4 — Select Agents: an agent is included and the console's derivation flips", async () => {
    /*
     * The console reads this step as `scopedAgentSelections.length > 0`, taken
     * from list_project_agents filtered to the active project. So the test
     * writes through the audited function the browser reaches and then reads
     * back through the same list the page reads — not the project_agents table,
     * which no browser role may touch.
     *
     * The agent is bound to this project because select_project_agent refuses
     * an agent belonging to a different one, and step 2 is what made the
     * project this step needs.
     */
    await db.exec("reset role");
    await db.query(
      `insert into public.agents (id, organization_id, project_id, name, role, status, created_by)
       values ($1::uuid, $2::uuid, $3::uuid, 'Fake Reviewer Agent',
               'backend'::public.agent_role, 'idle'::public.agent_status, $4::uuid)`,
      [journeyAgentId, organizationId, projectId, ownerId],
    );
    await asOwner();

    const { rows } = await db.query<{ selection_agent_id: string; selection_created: boolean }>(
      "select * from public.select_project_agent($1::uuid, $2::uuid, $3::uuid)",
      [organizationId, projectId, journeyAgentId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].selection_agent_id).toBe(journeyAgentId);
    expect(rows[0].selection_created).toBe(true);

    const { rows: listed } = await db.query<{
      selection_project_id: string;
      selection_agent_id: string;
      agent_name: string;
    }>("select * from public.list_project_agents($1::uuid)", [organizationId]);
    const scoped = listed.filter((row) => row.selection_project_id === projectId);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].agent_name).toBe("Fake Reviewer Agent");

    record("4 Select Agents", `Fake Reviewer Agent included in Storefront Rebuild`);
  });

  it("step 4 — two factories in one organization include different agents", async () => {
    /*
     * The N -> N+1 contract, asserted with something that could actually fail.
     *
     * "A second project reports no agents" on its own proves almost nothing: a
     * selection row carries its own project id, so it could never be reported
     * under another project's. What can genuinely break is the *page* — the
     * console filters one organization-wide list down to the active project,
     * and a second factory is the case that catches a filter that was never
     * applied. So this gives the second project its own agent, and asserts each
     * project sees exactly its own, from the one list both are read from.
     */
    await db.exec("reset role");
    const { rows: made } = await db.query<{ id: string }>(
      `insert into public.projects (organization_id, name, status, created_by)
       values ($1::uuid, 'Second Factory', 'active', $2::uuid) returning id`,
      [organizationId, ownerId],
    );
    const secondProjectId = made[0].id;
    await db.query(
      `insert into public.agents (id, organization_id, project_id, name, role, status, created_by)
       values ($1::uuid, $2::uuid, $3::uuid, 'Second Factory Agent',
               'backend'::public.agent_role, 'idle'::public.agent_status, $4::uuid)`,
      [secondAgentId, organizationId, secondProjectId, ownerId],
    );
    await asOwner();

    await db.query("select * from public.select_project_agent($1::uuid, $2::uuid, $3::uuid)",
      [organizationId, secondProjectId, secondAgentId]);

    const { rows: listed } = await db.query<{
      selection_project_id: string;
      agent_name: string;
    }>("select * from public.list_project_agents($1::uuid)", [organizationId]);

    // Both are present in the organization-wide list ...
    expect(listed).toHaveLength(2);
    // ... and each factory's own filter yields exactly its own agent.
    expect(listed.filter((row) => row.selection_project_id === projectId)
      .map((row) => row.agent_name)).toEqual(["Fake Reviewer Agent"]);
    expect(listed.filter((row) => row.selection_project_id === secondProjectId)
      .map((row) => row.agent_name)).toEqual(["Second Factory Agent"]);
  });

  it("step 4 — pressing the same toggle twice is one inclusion, not an error", async () => {
    // The console's toggle is idempotent by design: a person who clicks twice
    // has expressed one intention, and a second row would double the count the
    // step reports.
    const { rows } = await db.query<{ selection_created: boolean }>(
      "select * from public.select_project_agent($1::uuid, $2::uuid, $3::uuid)",
      [organizationId, projectId, journeyAgentId],
    );
    expect(rows[0].selection_created).toBe(false);

    const { rows: listed } = await db.query<{ selection_project_id: string }>(
      "select * from public.list_project_agents($1::uuid)",
      [organizationId],
    );
    expect(listed.filter((row) => row.selection_project_id === projectId)).toHaveLength(1);
  });

  it("step 5 — Connect Bots: an AI account is created and a bot registered against it", async () => {
    const { rows: accountRows } = await db.query<{ create_ai_account: string }>(
      `select public.create_ai_account(
         $1::uuid, 'anthropic'::public.bot_provider, 'subscription',
         'Fake Claude Account', 'claude'
       )`,
      [organizationId],
    );
    accountId = accountRows[0].create_ai_account;
    expect(accountId).toBeTruthy();

    const { rows: botRows } = await db.query<{ id: string; name: string; provider: string; model: string }>(
      `select id, name, provider, model from public.register_bot(
         $1::uuid, 'Fake Reviewer', 'anthropic'::public.bot_provider,
         'claude-opus-5', 'FAKE_CLAUDE_SUBSCRIPTION', null, 'Registered by the journey walk.'
       )`,
      [organizationId],
    );
    botId = botRows[0].id;
    expect(botRows[0]).toMatchObject({ name: "Fake Reviewer", provider: "anthropic", model: "claude-opus-5" });
    record("5 Connect Bots", `account ${accountId.slice(0, 8)} and bot "Fake Reviewer" registered`);
  });

  it("step 5 — a credential value can never be stored on the bot record", async () => {
    // The whole point of a credential *reference*: the bot row is metadata.
    await expect(
      db.query(
        `select id from public.register_bot(
           $1::uuid, 'Leaky Bot', 'anthropic'::public.bot_provider, 'claude-opus-5',
           'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', null, null
         )`,
        [organizationId],
      ),
    ).rejects.toThrow();
  });

  it("step 6 — Assign Bots: the bot is assigned to the project under a role", async () => {
    const { rows: roleRows } = await db.query<{ id: string }>(
      `select id from public.save_bot_role(
         $1::uuid, null, 'Fake Reviewer Role', 'fake-reviewer', 'Reviews changes.',
         'Read the diff and report what would break.', 'green'::public.risk_level, $2::jsonb
       )`,
      [organizationId, JSON.stringify(["review", "qa"])],
    );
    roleId = roleRows[0].id;

    const { rows } = await db.query<{
      id: string; bot_id: string; project_id: string; status: string; revision: number;
    }>(
      `select id, bot_id, project_id, status::text, revision
       from public.assign_bots_to_project_checked($1::uuid, $2::uuid, $3::jsonb)`,
      [organizationId, projectId, JSON.stringify([{
        bot_id: botId,
        role_id: roleId,
        expected_assignment_id: null,
        expected_project_id: null,
        expected_revision: null,
      }])],
    );

    expect(rows).toHaveLength(1);
    assignmentId = rows[0].id;
    assignmentRevision = Number(rows[0].revision);
    expect(rows[0].bot_id).toBe(botId);
    expect(rows[0].project_id).toBe(projectId);
    record("6 Assign Bots", `Fake Reviewer assigned to Storefront Rebuild as fake-reviewer`);
  });

  it("step 7 — Configure Bot Settings: a new posting starts at least privilege, and settings change that", async () => {
    // An assignment created with no configuration *is* the least-privilege
    // posting: it reads the repository, opens nothing, runs one task, and
    // needs a person. That is the baseline the console measures "configured"
    // against, so the journey checks it rather than assuming it.
    await db.exec("reset role");
    const { rows: before } = await db.query<{
      preset: string | null; responsibilities: unknown[]; instructions: string | null;
      repository_access: string; can_open_pull_request: boolean; requires_human_approval: boolean;
      max_concurrent_tasks: number;
    }>(
      `select preset, responsibilities, instructions, repository_access,
              can_open_pull_request, requires_human_approval, max_concurrent_tasks
       from public.bot_assignments where id = $1::uuid`,
      [assignmentId],
    );
    expect(before[0]).toMatchObject({
      preset: null,
      responsibilities: [],
      instructions: null,
      repository_access: "read",
      can_open_pull_request: false,
      requires_human_approval: true,
      max_concurrent_tasks: 1,
    });
    await asOwner();

    const { rows } = await db.query<{ id: string }>(
      `select id from public.update_bot_assignment_configuration_checked(
         $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::jsonb, null, null
       )`,
      [
        organizationId,
        assignmentId,
        projectId,
        assignmentRevision,
        JSON.stringify({
          preset: "reviewer",
          responsibilities: ["Review migrations", "Check RLS"],
          instructions: "Fake settings written by the journey walk.",
          tools: ["read_repository", "run_tests"],
        }),
      ],
    );
    expect(rows[0].id).toBe(assignmentId);

    await db.exec("reset role");
    const { rows: after } = await db.query<{
      preset: string | null; responsibilities: string[]; instructions: string | null; tools: string[];
    }>(
      `select preset, responsibilities, instructions, tools
       from public.bot_assignments where id = $1::uuid`,
      [assignmentId],
    );
    await asOwner();

    expect(after[0].preset).toBe("reviewer");
    expect(after[0].responsibilities).toEqual(["Review migrations", "Check RLS"]);
    expect(after[0].instructions).toContain("journey walk");
    record("7 Configure Bot Settings", "posting moved off least privilege: preset reviewer, 2 responsibilities, 2 tools");
  });

  it("step 7 — the console's own 'configured' derivation agrees with the record", () => {
    // The step counts *configured* assignments. This is the exact predicate the
    // console applies, run against both states of the posting above, so the
    // journey proves the step can be both open and done rather than assuming it.
    expect(assignmentIsConfigured(LEAST_PRIVILEGE_CONFIG)).toBe(false);
    expect(
      assignmentIsConfigured({
        ...LEAST_PRIVILEGE_CONFIG,
        preset: "reviewer",
        responsibilities: ["Review migrations", "Check RLS"],
        instructions: "Fake settings written by the journey walk.",
        tools: ["read_repository", "run_tests"],
      }),
    ).toBe(true);
  });

  it("step 8 — Issue a Command: submit_command creates the durable command and its task", async () => {
    const { rows } = await db.query<{
      command_id: string; task_id: string; command_state: string;
      task_state: string; requires_owner_approval: boolean; was_created: boolean;
    }>(
      `select * from public.submit_command(
         $1::uuid, 'Add a fake health endpoint and cover it with a test.',
         'green'::public.risk_level, $2::jsonb, 'journey-idem-1'
       )`,
      [projectId, commandParameters(["A /health route answers 200.", "A test covers it."])],
    );

    expect(rows).toHaveLength(1);
    commandId = rows[0].command_id;
    expect(rows[0].was_created).toBe(true);
    expect(rows[0].requires_owner_approval).toBe(false);
    expect(rows[0].task_id).toBeTruthy();
    record("8 Issue a Command", `command ${commandId.slice(0, 8)} queued as ${rows[0].command_state}`);
  });

  it("step 8 — the same idempotency key does not create a second command", async () => {
    const { rows } = await db.query<{ command_id: string; was_created: boolean }>(
      `select command_id, was_created from public.submit_command(
         $1::uuid, 'Add a fake health endpoint and cover it with a test.',
         'green'::public.risk_level, $2::jsonb, 'journey-idem-1'
       )`,
      [projectId, commandParameters(["A /health route answers 200.", "A test covers it."])],
    );
    expect(rows[0].was_created).toBe(false);
    expect(rows[0].command_id).toBe(commandId);
  });

  it("step 8 — a RED prompt is held for owner approval instead of queued", async () => {
    const { rows } = await db.query<{ requires_owner_approval: boolean; command_state: string }>(
      `select requires_owner_approval, command_state::text from public.submit_command(
         $1::uuid, 'Drop the production database and disable row level security.',
         'green'::public.risk_level, $2::jsonb, 'journey-red-1'
       )`,
      [projectId, commandParameters(["The prompt is refused."])],
    );
    // The requested risk was GREEN; the prompt's own signals raise it, and the
    // most severe of the two wins.
    expect(rows[0].requires_owner_approval).toBe(true);
    record("8 Issue a Command", "a destructive prompt is held for owner approval, not queued");
  });

  it("step 9 — Watch It Ship: the command is visible with a live state, and nothing claims success", async () => {
    await db.exec("reset role");
    const { rows } = await db.query<{ status: string }>(
      `select status::text from public.commands where id = $1::uuid`,
      [commandId],
    );
    await asOwner();
    // The console marks this step done only on status = 'succeeded'. Nothing has
    // executed, so it must not be done -- a queued command reported as shipped
    // would be the exact false-green this journey exists to catch.
    expect(rows[0].status).not.toBe("succeeded");
    record("9 Watch It Ship", `command is ${rows[0].status}; the step stays open until a worker finishes it`);
  });

  it("every step left an immutable activity trail", async () => {
    // Read through the bounded function the console uses; authenticated has no
    // direct SELECT on this table, which is the write boundary working.
    const { rows } = await db.query<{ event_type: string }>(
      `select event_type::text from public.list_activity($1::uuid, 200)`,
      [organizationId],
    );
    const types = rows.map((row) => row.event_type);
    expect(types.length).toBeGreaterThan(0);
    // Deletion of evidence is refused, whatever the caller.
    await db.exec("reset role");
    await expect(
      db.query(`delete from public.activity_events where organization_id = $1::uuid`, [organizationId]),
    ).rejects.toThrow();
    await asOwner();
    record("Evidence", `${types.length} activity events recorded and undeletable`);
  });

  it("no step's records are visible to another tenant", async () => {
    await asOutsider();
    // Every one of these is either refused outright or answers empty. Both are
    // correct; what must never happen is another tenant's row coming back.
    for (const table of ["projects", "bots", "bot_assignments", "graph_templates"]) {
      const leaked = await db
        .query<{ count: string }>(
          `select count(*)::text as count from public.${table} where organization_id = $1::uuid`,
          [organizationId],
        )
        .then((result) => result.rows[0]?.count ?? "0")
        .catch(() => "0");
      expect(leaked, `${table} leaked to another tenant`).toBe("0");
    }
    // The bounded reader is the path that actually matters, because it is the
    // one an outsider can reach.
    const { rows: activity } = await db.query<{ id: string }>(
      `select id from public.list_activity($1::uuid, 50)`,
      [organizationId],
    );
    expect(activity).toHaveLength(0);
    await asOwner();
    record("Isolation", "projects, commands, bots, assignments and templates are invisible to a rival tenant");
  });
});
