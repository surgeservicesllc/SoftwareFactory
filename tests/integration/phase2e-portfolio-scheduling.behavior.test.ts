// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

/**
 * Phase 2E: does the factory schedule a *portfolio*, or one project at a time?
 *
 * The distinction these tests are built around: a queue that stores work in
 * priority order proves nothing, because the old scheduler already ordered by
 * `task.priority`. What was missing was any relationship *between* projects —
 * two projects had no relative standing, no shared ceiling, and no way for an
 * incident in one to outrank routine work in another.
 *
 * So every test here involves at least two projects competing, and asserts on
 * which run a real worker actually claimed through `claim_phase1c_run` — not on
 * what a view says the order should be.
 *
 * PGlite is a single connection, so these are sequential claims rather than
 * simultaneous ones. That is a genuine limit: it proves ordering, ceilings and
 * releases, and it cannot prove race behaviour under contention. The `for
 * update ... skip locked` that handles contention is unchanged from Phase 1C.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260817000900_assignment_model_and_effort.sql";

const ownerId = "00000000-0000-4000-8000-0000000002e1";
const outsiderId = "00000000-0000-4000-8000-0000000002e2";
const organizationId = "10000000-0000-4000-8000-0000000002e1";

interface ProjectFixture {
  readonly connectionId: string;
  readonly externalInstallationId: number;
  readonly externalRepositoryId: number;
  readonly installationId: string;
  readonly name: string;
  readonly projectId: string;
  readonly repository: string;
  readonly repositoryId: string;
}

const alpha: ProjectFixture = {
  connectionId: "30000000-0000-4000-8000-0000000002e1",
  externalInstallationId: 153445938,
  externalRepositoryId: 99887761,
  installationId: "40000000-0000-4000-8000-0000000002e1",
  name: "Alpha",
  projectId: "20000000-0000-4000-8000-0000000002e1",
  repository: "surgeservicesllc/alpha",
  repositoryId: "50000000-0000-4000-8000-0000000002e1",
};

const beta: ProjectFixture = {
  connectionId: "30000000-0000-4000-8000-0000000002e2",
  externalInstallationId: 153445939,
  externalRepositoryId: 99887762,
  installationId: "40000000-0000-4000-8000-0000000002e2",
  name: "Beta",
  projectId: "20000000-0000-4000-8000-0000000002e2",
  repository: "surgeservicesllc/beta",
  repositoryId: "50000000-0000-4000-8000-0000000002e2",
};

const appId = 4573846;

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
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

  const migrations = (await readdir(migrationsRoot))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  // Pinned so a new migration cannot land without this suite being re-run
  // against it. Portfolio scheduling touches the claim path, which nearly
  // every other durable behaviour depends on.
  expect(migrations.at(-1)).toBe(latestMigration);
  for (const migration of migrations) {
    await db.exec(await readFile(resolve(migrationsRoot, migration), "utf8"));
  }
  return db;
}

function seedProject(project: ProjectFixture) {
  return `
    insert into public.projects (
      id, organization_id, name, status, github_repository, default_branch, created_by
    ) values (
      '${project.projectId}', '${organizationId}', '${project.name}', 'active',
      '${project.repository}', 'main', '${ownerId}'
    );
    insert into public.connections (
      id, organization_id, name, provider, status, external_account_label,
      secret_reference, created_by
    ) values (
      '${project.connectionId}', '${organizationId}', 'GitHub App ${project.name}',
      'github', 'connected', 'surgeservicesllc', 'env://GITHUB_APP', '${ownerId}'
    );
    insert into public.github_installations (
      id, organization_id, connection_id, external_installation_id, app_id,
      app_slug, account_id, account_login, account_type, target_type,
      repository_selection, status, installed_at, created_by
    ) values (
      '${project.installationId}', '${organizationId}', '${project.connectionId}',
      ${project.externalInstallationId}, ${appId}, 'softwarefactory', 839271,
      'surgeservicesllc', 'Organization', 'Organization', 'selected', 'active',
      now(), '${ownerId}'
    );
    insert into public.github_repositories (
      id, organization_id, installation_id, external_repository_id, owner_login,
      name, full_name, default_branch, html_url, private, visibility, selected,
      github_updated_at
    ) values (
      '${project.repositoryId}', '${organizationId}', '${project.installationId}',
      ${project.externalRepositoryId}, 'surgeservicesllc',
      '${project.repository.split("/")[1]}', '${project.repository}', 'main',
      'https://github.com/${project.repository}', true, 'private', true, now()
    );
    insert into public.project_connections (
      organization_id, project_id, connection_id, github_repository_id, is_primary, created_by
    ) values (
      '${organizationId}', '${project.projectId}', '${project.connectionId}',
      '${project.repositoryId}', true, '${ownerId}'
    );
  `;
}

async function seedPortfolio(db: PGlite) {
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
    insert into public.organizations (id, name, slug, created_by)
    values ('${organizationId}', 'Portfolio Factory', 'phase2e-portfolio', '${ownerId}');
    ${seedProject(alpha)}
    ${seedProject(beta)}
  `);
}

async function actAs(db: PGlite, userId: string, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`set role ${role}`);
}

async function asWorker(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role service_role");
}

function commandParameters(
  project: ProjectFixture,
  commandType: string,
  agentRole: string,
  dependencyTaskIds: string[] = [],
) {
  return {
    acceptanceCriteria: ["The requested outcome is verified."],
    agentRole,
    budget: {
      ciTimeoutMs: 900000,
      maximumDurationMs: 2700000,
      maximumInputTokens: 200000,
      maximumOutputTokens: 50000,
      maximumRepairAttempts: 1,
      maximumTurns: 4,
    },
    commandType,
    dependencyTaskIds,
    executionMode: "manual",
    model: "gpt-5.3-codex",
    plan: {
      requiresDraftPullRequest: true,
      stages: [
        "inspect", "implement", "validate", "policy_scan", "commit",
        "draft_pull_request", "ci", "report",
      ],
      workflow: "codex_draft_pr",
    },
    provider: "openai",
    repositoryBinding: {
      appId,
      baseBranch: "main",
      baseSha: "a".repeat(40),
      connectionId: project.connectionId,
      externalInstallationId: project.externalInstallationId,
      externalRepositoryId: project.externalRepositoryId,
      installationId: project.installationId,
      repositoryId: project.repositoryId,
    },
    riskAssessment: { requestedRisk: "green" },
  };
}

async function submit(
  db: PGlite,
  project: ProjectFixture,
  key: string,
  commandType = "audit",
  agentRole = "qa",
  dependencyTaskIds: string[] = [],
) {
  await actAs(db, ownerId);
  const { rows } = await db.query<{ command_id: string; task_id: string }>(
    "select command_id, task_id from public.submit_command($1,$2,$3,$4::jsonb,$5)",
    [
      project.projectId,
      // Deliberately kept free of the words that make a command RED. An earlier
      // version interpolated the idempotency key into the prompt, and a key
      // containing "rls" classified the command as RED, which never enters
      // Phase 1C at all — the queue was empty for a reason that had nothing to
      // do with scheduling.
      `Improve the ${project.name} dashboard copy.`,
      "green",
      JSON.stringify(commandParameters(project, commandType, agentRole, dependencyTaskIds)),
      key,
    ],
  );
  return rows[0];
}

/**
 * Drives a claimed run to an honest `succeeded` completion: recorded
 * validation, branch and commit artifacts, a canonical draft-PR artifact for
 * the run's own repository, then terminal evidence with a passing check. This
 * is the same evidence chain the contract suite proves the worker must
 * produce; nothing here bypasses a guard.
 */
async function succeed(
  db: PGlite,
  workerId: string,
  run: ClaimedRun,
  project: ProjectFixture,
  pullNumber: number,
) {
  await asWorker(db);
  const headBranch = `factory/${project.name.toLowerCase()}-cross-dep-${pullNumber}`;
  const headSha = "c".repeat(40);
  await db.query("select public.record_phase1c_validation($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    workerId, run.run_id, run.lease_token, 1, "diff-check", "git diff --check", "passed", 5, "clean",
  ]);
  await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
    workerId, run.run_id, run.lease_token, "branch", headBranch, null,
    JSON.stringify({ protected: false }),
  ]);
  await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
    workerId, run.run_id, run.lease_token, "commit", headSha, null,
    JSON.stringify({ branch: headBranch }),
  ]);
  await db.query("select public.record_phase1c_run_artifact($1,$2,$3,$4,$5,$6,$7::jsonb)", [
    workerId, run.run_id, run.lease_token, "pull_request",
    `https://github.com/${project.repository}/pull/${pullNumber}`, pullNumber,
    JSON.stringify({ commitSha: headSha }),
  ]);
  await db.query(
    "select * from public.complete_phase1c_run($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)",
    [
      workerId, run.run_id, run.lease_token, "succeeded",
      "The prerequisite work is finished and evidenced.",
      `provider-run-${pullNumber}`, JSON.stringify({ inputTokens: 10, outputTokens: 10 }),
      JSON.stringify(["README.md"]),
      JSON.stringify([{ name: "CI", status: "completed", conclusion: "success" }]),
      null, null, false,
    ],
  );
}

async function declareDependency(
  db: PGlite,
  dependentTaskId: string,
  prerequisiteTaskId: string,
  reason: string | null,
) {
  await actAs(db, ownerId);
  return db.query<{ dependency_id: string }>(
    "select * from public.declare_cross_project_dependency($1::uuid,$2::uuid,$3)",
    [dependentTaskId, prerequisiteTaskId, reason],
  );
}

async function releaseDependency(
  db: PGlite,
  dependentTaskId: string,
  prerequisiteTaskId: string,
  reason: string | null,
) {
  await actAs(db, ownerId);
  return db.query(
    "select * from public.release_cross_project_dependency($1::uuid,$2::uuid,$3)",
    [dependentTaskId, prerequisiteTaskId, reason],
  );
}

async function registerWorker(db: PGlite, workerId: string, capacity = 1) {
  await asWorker(db);
  await db.query("select * from public.register_phase1c_worker($1,$2,$3::jsonb)", [
    workerId, "1.0.0", JSON.stringify({ providers: ["openai"] }),
  ]);
  await db.exec("reset role");
  await db.query(
    "update public.phase1c_workers set maximum_concurrent_runs = $2 where worker_id = $1",
    [workerId, capacity],
  );
}

interface ClaimedRun {
  lease_token: string;
  project_id: string;
  run_id: string;
  task_id: string;
}

async function claim(db: PGlite, workerId: string) {
  await asWorker(db);
  const { rows } = await db.query<ClaimedRun>(
    "select run_id, project_id, task_id, lease_token from public.claim_phase1c_run($1,$2,$3,$4)",
    [workerId, "openai", "gpt-5.3-codex", 120],
  );
  return rows[0] ?? null;
}

async function finish(db: PGlite, workerId: string, run: ClaimedRun) {
  await asWorker(db);
  await db.query(
    `select * from public.complete_phase1c_run(
       $1,$2::uuid,$3::uuid,'failed','Stopped for the capacity test.',null,
       '{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'stopped_for_test',
       'Released deliberately so the next claim can be observed.',false)`,
    [workerId, run.run_id, run.lease_token],
  );
}

async function setPriority(db: PGlite, project: ProjectFixture, priority: number) {
  await actAs(db, ownerId);
  await db.query(
    "select * from public.set_project_engineering_priority($1::uuid,$2::smallint,$3)",
    [project.projectId, priority, "Portfolio scheduling test"],
  );
}

async function setLimits(
  db: PGlite,
  limits: {
    emergencyReserved?: number;
    global?: number;
    project?: ProjectFixture;
    projectLimit?: number;
  },
) {
  await actAs(db, ownerId);
  await db.query(
    `select * from public.set_portfolio_capacity_limits(
       $1::uuid,$2::smallint,$3::smallint,null,$4::uuid,$5::smallint)`,
    [
      organizationId,
      limits.global ?? null,
      limits.emergencyReserved ?? null,
      limits.project?.projectId ?? null,
      limits.projectLimit ?? null,
    ],
  );
}

describe("Phase 2E portfolio scheduling", { timeout: 180_000 }, () => {
  it("gives the worker the higher-priority project's work first — canary A", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      // Beta's work is queued first, so age alone would hand it the worker.
      await submit(db, beta, "beta-routine");
      await submit(db, alpha, "alpha-routine");
      await setPriority(db, beta, 3);
      await setPriority(db, alpha, 1);
      await registerWorker(db, "portfolio-worker-a");

      const first = await claim(db, "portfolio-worker-a");
      expect(first?.project_id).toBe(alpha.projectId);

      // And the point of a portfolio rather than a preference: once Alpha's
      // work is running, Beta is next rather than starved.
      await finish(db, "portfolio-worker-a", first!);
      const second = await claim(db, "portfolio-worker-a");
      expect(second?.project_id).toBe(beta.projectId);
    } finally {
      await db.close();
    }
  });

  it("keeps a slot for an incident and does not kill anything to make it — canary B", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      // One slot in total, of which one is reserved for emergencies: ordinary
      // work may use zero. This is the reservation in its starkest form.
      await setLimits(db, { emergencyReserved: 1, global: 1 });

      await submit(db, beta, "beta-routine");
      await registerWorker(db, "portfolio-worker-b");

      expect(await claim(db, "portfolio-worker-b")).toBeNull();

      // A withheld decision is recorded, naming the reserve as the reason.
      await actAs(db, ownerId);
      const withheld = await db.query<{ decision: string; reason: string }>(
        `select decision, reason from public.scheduling_decisions
         where organization_id = $1 order by occurred_at desc limit 1`,
        [organizationId],
      );
      expect(withheld.rows[0]).toMatchObject({ decision: "withheld" });
      expect(withheld.rows[0].reason).toMatch(/reserved for emergency/i);

      // Now real emergency work: an incident with a repair attempt bound to the
      // task, which is what the 1E→1C promotion writes.
      const emergency = await submit(db, alpha, "alpha-incident");
      await db.exec("reset role");
      await db.query(
        `insert into public.incidents (
           id, organization_id, project_id, title, description, severity, status, detected_at
         ) values (
           '70000000-0000-4000-8000-0000000002e1', $1, $2, 'Checkout is failing',
           'Errors on the production checkout path.', 'critical', 'open', now()
         )`,
        [organizationId, alpha.projectId],
      );
      await db.query(
        `insert into public.repair_attempts (
           organization_id, project_id, incident_id, task_id, attempt_number, state
         ) values ($1, $2, '70000000-0000-4000-8000-0000000002e1', $3, 1, 'created')`,
        [organizationId, alpha.projectId, emergency.task_id],
      );

      const claimed = await claim(db, "portfolio-worker-b");
      expect(claimed?.project_id).toBe(alpha.projectId);
      expect(claimed?.task_id).toBe(emergency.task_id);

      await actAs(db, ownerId);
      const assignment = await db.query<{
        decision: string;
        effective_priority: number;
        reason: string;
      }>(
        `select decision, effective_priority, reason from public.scheduling_decisions
         where run_id = $1`,
        [claimed!.run_id],
      );
      expect(assignment.rows[0]).toMatchObject({
        decision: "assigned",
        effective_priority: 0,
      });

      // Beta's routine work was never cancelled to make room — it is still
      // queued, waiting for capacity rather than destroyed by the emergency.
      // Read outside the browser role: `agent_runs` is deliberately not
      // selectable by `authenticated`.
      await db.exec("reset role");
      const betaRuns = await db.query<{ status: string }>(
        `select run.status::text from public.agent_runs run where run.project_id = $1`,
        [beta.projectId],
      );
      expect(betaRuns.rows.map((row) => row.status)).toEqual(["queued"]);
    } finally {
      await db.close();
    }
  });

  it("queues excess work and starts it only as capacity releases — canary C", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, {
        emergencyReserved: 0,
        global: 4,
        project: alpha,
        projectLimit: 1,
      });

      // Two units of work in Alpha, and different roles so the agent-exclusion
      // rule is not what limits them: the project ceiling should be.
      await submit(db, alpha, "alpha-first", "audit", "qa");
      await submit(db, alpha, "alpha-second", "build_feature", "backend");
      await registerWorker(db, "portfolio-worker-c", 2);

      const first = await claim(db, "portfolio-worker-c");
      expect(first?.project_id).toBe(alpha.projectId);

      // Capacity, not the worker, is what stops the second: the worker is
      // declared able to hold two leases.
      expect(await claim(db, "portfolio-worker-c")).toBeNull();

      await actAs(db, ownerId);
      const withheld = await db.query<{ capacity: Record<string, unknown>; reason: string }>(
        `select reason, capacity from public.scheduling_decisions
         where decision = 'withheld' order by occurred_at desc limit 1`,
      );
      expect(withheld.rows[0].reason).toMatch(/Project is at its concurrency ceiling/);
      expect(withheld.rows[0].capacity).toMatchObject({ projectActive: 1, projectLimit: 1 });

      await finish(db, "portfolio-worker-c", first!);
      const second = await claim(db, "portfolio-worker-c");
      expect(second?.project_id).toBe(alpha.projectId);
      expect(second?.run_id).not.toBe(first!.run_id);
    } finally {
      await db.close();
    }
  });

  it("reprioritizes the queue on an owner command without disturbing running work — canary E", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      await setPriority(db, alpha, 2);
      await setPriority(db, beta, 2);

      // Alpha starts something and keeps running throughout.
      await submit(db, alpha, "alpha-running", "audit", "qa");
      await registerWorker(db, "portfolio-worker-e", 3);
      const running = await claim(db, "portfolio-worker-e");
      expect(running?.project_id).toBe(alpha.projectId);

      // Queue one unit in each project, Beta's first so age favours it.
      await submit(db, beta, "beta-next", "build_feature", "backend");
      await submit(db, alpha, "alpha-next", "build_feature", "backend");

      // "Focus engineering capacity on Project A."
      await actAs(db, ownerId);
      const focused = await db.query<{ project_id: string; strategic_focus: boolean }>(
        "select project_id, strategic_focus from public.focus_portfolio_engineering($1::uuid,$2::uuid[],$3)",
        [organizationId, [alpha.projectId], "Focus engineering capacity on Alpha"],
      );
      expect(
        focused.rows.find((row) => row.project_id === alpha.projectId)?.strategic_focus,
      ).toBe(true);
      expect(
        focused.rows.find((row) => row.project_id === beta.projectId)?.strategic_focus,
      ).toBe(false);

      const next = await claim(db, "portfolio-worker-e");
      expect(next?.project_id).toBe(alpha.projectId);

      // The run that was already going is untouched: same lease, still running.
      await db.exec("reset role");
      const untouched = await db.query<{ lease_token: string; status: string }>(
        "select status::text, lease_token::text from public.agent_runs where id = $1",
        [running!.run_id],
      );
      expect(untouched.rows[0]).toMatchObject({
        lease_token: running!.lease_token,
        status: "running",
      });

      // History survives the reprioritization.
      await db.exec("reset role");
      const history = await db.query<{ event_type: string }>(
        `select event_type::text from public.activity_events
         where organization_id = $1 and event_type::text = 'project.strategic_focus_changed'`,
        [organizationId],
      );
      expect(history.rows).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  it("runs two projects at once, which a shared agent roster made impossible", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });

      // The same role in both projects. Before project-scoped agents these two
      // shared one Backend agent and could never hold leases simultaneously.
      await submit(db, alpha, "alpha-feature", "build_feature", "backend");
      await submit(db, beta, "beta-feature", "build_feature", "backend");
      await registerWorker(db, "portfolio-worker-f", 2);

      const first = await claim(db, "portfolio-worker-f");
      const second = await claim(db, "portfolio-worker-f");
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(new Set([first!.project_id, second!.project_id])).toEqual(
        new Set([alpha.projectId, beta.projectId]),
      );

      await db.exec("reset role");
      const live = await db.query<{ count: number }>(
        `select count(*)::int as count from public.agent_runs
         where status = 'running' and lease_expires_at > now()`,
      );
      expect(live.rows[0].count).toBe(2);

      // Each project got its own agent rather than sharing one.
      // `submit_command` derives the role from the command type — build_feature
      // is `architect` — and overwrites whatever agentRole was passed, so the
      // role is asserted as the database actually assigns it.
      const agents = await db.query<{ project_id: string | null }>(
        `select project_id::text from public.agents
         where organization_id = $1 and role = 'architect'
         order by project_id nulls first`,
        [organizationId],
      );
      expect(agents.rows.map((row) => row.project_id)).toEqual([
        null, alpha.projectId, beta.projectId,
      ]);
    } finally {
      await db.close();
    }
  });

  it("stops scheduling a paused project and resumes it exactly where it was", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      await setPriority(db, alpha, 1);
      await setPriority(db, beta, 2);

      await submit(db, alpha, "alpha-paused");
      await submit(db, beta, "beta-open");
      await registerWorker(db, "portfolio-worker-p");

      await actAs(db, ownerId);
      await db.query(
        "select * from public.set_project_engineering_pause($1::uuid, true, $2)",
        [alpha.projectId, "Owner paused Alpha while a migration lands"],
      );

      // Alpha outranks Beta and would otherwise win; paused means paused.
      const duringPause = await claim(db, "portfolio-worker-p");
      expect(duringPause?.project_id).toBe(beta.projectId);
      await finish(db, "portfolio-worker-p", duringPause!);

      expect(await claim(db, "portfolio-worker-p")).toBeNull();

      await actAs(db, ownerId);
      await db.query(
        "select * from public.set_project_engineering_pause($1::uuid, false, null)",
        [alpha.projectId],
      );
      const afterResume = await claim(db, "portfolio-worker-p");
      expect(afterResume?.project_id).toBe(alpha.projectId);

      // A resumed project keeps no stale explanation of a pause that ended.
      await db.exec("reset role");
      const project = await db.query<{
        engineering_pause_reason: string | null;
        engineering_paused_at: string | null;
        engineering_paused_by: string | null;
      }>(
        `select engineering_paused_at, engineering_paused_by::text, engineering_pause_reason
         from public.projects where id = $1`,
        [alpha.projectId],
      );
      expect(project.rows[0]).toEqual({
        engineering_pause_reason: null,
        engineering_paused_at: null,
        engineering_paused_by: null,
      });
    } finally {
      await db.close();
    }
  });

  it("promotes waiting work one tier per interval, and never into the emergency reserve", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      const priorities = await db.query<{
        aged_far: number;
        aged_one: number;
        emergency: number;
        focused: number;
        fresh: number;
      }>(`
        select
          public.effective_work_priority(3::smallint, false, false, now(), 900, now()) as fresh,
          public.effective_work_priority(
            3::smallint, false, false, now() - interval '16 minutes', 900, now()
          ) as aged_one,
          -- Ten hours of waiting: far past every promotion step available.
          public.effective_work_priority(
            3::smallint, false, false, now() - interval '10 hours', 900, now()
          ) as aged_far,
          public.effective_work_priority(
            1::smallint, true, false, now() - interval '10 hours', 900, now()
          ) as focused,
          public.effective_work_priority(3::smallint, false, true, now(), 900, now()) as emergency
      `);

      expect(priorities.rows[0]).toEqual({
        aged_far: 1,
        aged_one: 2,
        emergency: 0,
        focused: 1,
        fresh: 3,
      });
    } finally {
      await db.close();
    }
  });

  it("lets an aged low-priority project beat a fresh higher-priority one", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      await setPriority(db, beta, 3);
      await setPriority(db, alpha, 1);

      const aged = await submit(db, beta, "beta-waiting");
      await submit(db, alpha, "alpha-fresh");

      // Beta has been waiting long enough for two promotions: P3 → P1. Alpha is
      // P1 and newer, so the oldest-first tie-break hands the worker to Beta.
      await db.exec("reset role");
      await db.query(
        "update public.agent_runs set created_at = now() - interval '40 minutes' where task_id = $1",
        [aged.task_id],
      );

      await registerWorker(db, "portfolio-worker-fair");
      const claimed = await claim(db, "portfolio-worker-fair");
      expect(claimed?.project_id).toBe(beta.projectId);

      await actAs(db, ownerId);
      const decision = await db.query<{ effective_priority: number }>(
        "select effective_priority from public.scheduling_decisions where run_id = $1",
        [claimed!.run_id],
      );
      expect(decision.rows[0].effective_priority).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("holds a worker to its declared capacity", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 8 });
      await submit(db, alpha, "alpha-one", "audit", "qa");
      await submit(db, beta, "beta-one", "build_feature", "backend");
      // Capacity one: ample portfolio headroom, distinct projects, distinct
      // agents. The only thing left to stop the second claim is the worker.
      await registerWorker(db, "portfolio-worker-single", 1);

      expect(await claim(db, "portfolio-worker-single")).not.toBeNull();
      expect(await claim(db, "portfolio-worker-single")).toBeNull();

      await registerWorker(db, "portfolio-worker-second", 1);
      expect(await claim(db, "portfolio-worker-second")).not.toBeNull();
    } finally {
      await db.close();
    }
  });

  it("enforces a provider account ceiling across the whole portfolio", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 8 });
      await actAs(db, ownerId);
      await db.query(
        "select * from public.set_provider_capacity_limit($1::uuid,'openai',1::smallint,null)",
        [organizationId],
      );

      await submit(db, alpha, "alpha-provider", "audit", "qa");
      await submit(db, beta, "beta-provider", "build_feature", "backend");
      await registerWorker(db, "portfolio-worker-x", 4);
      await registerWorker(db, "portfolio-worker-y", 4);

      expect(await claim(db, "portfolio-worker-x")).not.toBeNull();
      // A second worker, a second project, a second agent, portfolio headroom
      // to spare — and still no claim, because the provider account is the
      // binding constraint.
      expect(await claim(db, "portfolio-worker-y")).toBeNull();

      await actAs(db, ownerId);
      const withheld = await db.query<{ reason: string }>(
        `select reason from public.scheduling_decisions
         where decision = 'withheld' order by occurred_at desc limit 1`,
      );
      expect(withheld.rows[0].reason).toMatch(/Provider account is at its concurrency ceiling/);
    } finally {
      await db.close();
    }
  });

  it("records what it assigned, and does not record the same withholding twice a minute", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 1 });
      await submit(db, alpha, "alpha-audit", "audit", "qa");
      await submit(db, beta, "beta-audit", "build_feature", "backend");
      await registerWorker(db, "portfolio-worker-audit", 4);

      const claimed = await claim(db, "portfolio-worker-audit");
      await actAs(db, ownerId);
      const assignment = await db.query<{
        agent_id: string | null;
        connection_id: string | null;
        model: string;
        project_id: string | null;
        provider: string;
        reason: string;
        task_id: string | null;
        worker_id: string;
      }>(
        `select project_id::text, task_id::text, agent_id::text, connection_id::text,
           worker_id, provider, model, reason
         from public.scheduling_decisions where run_id = $1`,
        [claimed!.run_id],
      );
      // Goal 28, item by item.
      expect(assignment.rows[0].project_id).toBe(claimed!.project_id);
      expect(assignment.rows[0].task_id).toBe(claimed!.task_id);
      expect(assignment.rows[0].agent_id).not.toBeNull();
      expect(assignment.rows[0].connection_id).not.toBeNull();
      expect(assignment.rows[0]).toMatchObject({
        model: "gpt-5.3-codex",
        provider: "openai",
        worker_id: "portfolio-worker-audit",
      });
      expect(assignment.rows[0].reason.length).toBeGreaterThan(0);

      // Three more polls against an unchanged ceiling.
      await claim(db, "portfolio-worker-audit");
      await claim(db, "portfolio-worker-audit");
      await claim(db, "portfolio-worker-audit");

      await actAs(db, ownerId);
      const withheld = await db.query<{ count: number }>(
        `select count(*)::int as count from public.scheduling_decisions
         where decision = 'withheld'`,
      );
      expect(withheld.rows[0].count).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("suppresses a failing provider, keeps other work moving, and recovers — canary D", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      await submit(db, alpha, "alpha-breaker", "audit", "qa");
      await registerWorker(db, "portfolio-worker-d", 2);

      // Three consecutive outages on the model this factory actually uses.
      // Driven through separate calls because that is how a breaker really
      // accumulates — one failed request at a time.
      await actAs(db, ownerId);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await db.query(
          `select * from public.record_resource_breaker_fault(
             $1::uuid, 'openai/gpt-5.3-codex', 'outage', 3)`,
          [organizationId],
        );
      }
      await db.exec("reset role");
      const opened = await db.query<{ state: string }>(
        "select state from public.resource_breakers where target = 'openai/gpt-5.3-codex'",
      );
      expect(opened.rows[0].state).toBe("open");

      // The work is otherwise perfectly schedulable: capacity everywhere, an
      // idle worker, an active project. Health is the only thing stopping it.
      expect(await claim(db, "portfolio-worker-d")).toBeNull();

      await actAs(db, ownerId);
      const withheld = await db.query<{ reason: string }>(
        `select reason from public.scheduling_decisions
         where decision = 'withheld' order by occurred_at desc limit 1`,
      );
      expect(withheld.rows[0].reason).toMatch(/3 consecutive outage failures/);

      // A breaker on a different provider is not this provider's problem.
      await db.query(
        "select * from public.record_resource_breaker_success($1::uuid, 'openai/gpt-5.3-codex')",
        [organizationId],
      );
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await db.query(
          `select * from public.record_resource_breaker_fault(
             $1::uuid, 'anthropic', 'rate_limit', 2)`,
          [organizationId],
        );
      }
      const unrelated = await claim(db, "portfolio-worker-d");
      expect(unrelated?.project_id).toBe(alpha.projectId);
      await finish(db, "portfolio-worker-d", unrelated!);

      // Re-open the model breaker, then let its cooldown elapse. The trial is
      // admitted — and taking it restarts the clock, so a second poller in the
      // same window is suppressed again rather than both being let through.
      await actAs(db, ownerId);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await db.query(
          `select * from public.record_resource_breaker_fault(
             $1::uuid, 'openai/gpt-5.3-codex', 'outage', 3)`,
          [organizationId],
        );
      }
      await submit(db, beta, "beta-after-breaker", "build_feature", "architect");
      await submit(db, alpha, "alpha-after-breaker", "build_feature", "architect");
      await db.exec("reset role");
      await db.query(
        `update public.resource_breakers set opened_at = now() - interval '10 minutes'
         where target = 'openai/gpt-5.3-codex'`,
      );

      const trial = await claim(db, "portfolio-worker-d");
      expect(trial).not.toBeNull();
      await registerWorker(db, "portfolio-worker-d2", 2);
      expect(await claim(db, "portfolio-worker-d2")).toBeNull();

      // The trial succeeding closes the breaker, and normal service resumes.
      await actAs(db, ownerId);
      await db.query(
        "select * from public.record_resource_breaker_success($1::uuid, 'openai/gpt-5.3-codex')",
        [organizationId],
      );
      expect(await claim(db, "portfolio-worker-d2")).not.toBeNull();
    } finally {
      await db.close();
    }
  });

  it("reassigns a failed run to a different worker through the same eligibility rules", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      const submitted = await submit(db, alpha, "alpha-retry", "audit", "qa");
      await registerWorker(db, "portfolio-worker-r1");
      await registerWorker(db, "portfolio-worker-r2");

      const first = await claim(db, "portfolio-worker-r1");
      expect(first).not.toBeNull();
      await asWorker(db);
      await db.query(
        `select * from public.complete_phase1c_run(
           $1,$2::uuid,$3::uuid,'failed','The provider failed mid-run.',null,
           '{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'provider_outage',
           'The provider returned a server error.',true)`,
        [ "portfolio-worker-r1", first!.run_id, first!.lease_token ],
      );

      await actAs(db, ownerId);
      await db.query("select * from public.retry_phase1c_run($1::uuid,$2::uuid,$3)", [
        organizationId, first!.run_id, "Retrying after a provider outage",
      ]);

      // A different worker picks it up: reassignment goes back through the same
      // eligibility rules rather than pinning the work to the worker that failed.
      const second = await claim(db, "portfolio-worker-r2");
      expect(second?.task_id).toBe(submitted.task_id);

      await actAs(db, ownerId);
      const assignments = await db.query<{ worker_id: string }>(
        `select worker_id from public.scheduling_decisions
         where decision = 'assigned' and task_id = $1 order by occurred_at`,
        [submitted.task_id],
      );
      expect(assignments.rows.map((row) => row.worker_id)).toEqual([
        "portfolio-worker-r1", "portfolio-worker-r2",
      ]);
    } finally {
      await db.close();
    }
  });

  it("shows the queue in the order the scheduler would take it, with reasons", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, {
        emergencyReserved: 0,
        global: 4,
        project: alpha,
        projectLimit: 1,
      });
      await setPriority(db, alpha, 1);
      await setPriority(db, beta, 3);

      await submit(db, alpha, "alpha-running", "audit", "qa");
      await submit(db, alpha, "alpha-waiting", "build_feature", "architect");
      await submit(db, beta, "beta-waiting", "audit", "qa");
      await registerWorker(db, "portfolio-worker-q", 4);
      const running = await claim(db, "portfolio-worker-q");
      expect(running?.project_id).toBe(alpha.projectId);

      await actAs(db, ownerId);
      const queue = await db.query<{
        blocked_reason: string | null;
        effective_priority: number;
        project_name: string;
        queue_position: number | null;
        run_status: string;
      }>(
        "select * from public.portfolio_scheduling_queue($1::uuid, 50)",
        [organizationId],
      );

      // Running first, then the queue in scheduler order: Alpha is P1 and Beta
      // is P3, so Alpha's queued item leads even though both are waiting.
      expect(queue.rows.map((row) => row.run_status)).toEqual([
        "running", "queued", "queued",
      ]);
      expect(queue.rows.map((row) => row.project_name)).toEqual(["Alpha", "Alpha", "Beta"]);
      expect(queue.rows.map((row) => row.queue_position)).toEqual([null, 1, 2]);

      // And each queued item says why it is not moving. Alpha's is capacity —
      // its project ceiling is one and one is running. Beta has room.
      expect(queue.rows[1].blocked_reason).toMatch(/Project is at its concurrency ceiling/);
      expect(queue.rows[2].blocked_reason).toBeNull();
      expect(queue.rows[0].blocked_reason).toBeNull();
    } finally {
      await db.close();
    }
  });

  it("says a paused project is paused rather than blaming capacity", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await submit(db, alpha, "alpha-paused-queue", "audit", "qa");
      await actAs(db, ownerId);
      await db.query(
        "select * from public.set_project_engineering_pause($1::uuid, true, $2)",
        [alpha.projectId, "Owner paused Alpha for a release freeze"],
      );

      const queue = await db.query<{ blocked_reason: string | null }>(
        "select blocked_reason from public.portfolio_scheduling_queue($1::uuid, 50)",
        [organizationId],
      );
      expect(queue.rows[0].blocked_reason).toBe("Project engineering is paused.");
    } finally {
      await db.close();
    }
  });

  it("reports capacity the console can show without inventing anything", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 1, global: 3 });
      await setPriority(db, beta, 3);
      await submit(db, alpha, "alpha-overview", "audit", "qa");
      await submit(db, beta, "beta-overview", "build_feature", "architect");
      await registerWorker(db, "portfolio-worker-o", 2);
      await claim(db, "portfolio-worker-o");

      await actAs(db, ownerId);
      const overview = await db.query<{
        active_runs: number;
        emergency_reserved: number;
        focused_projects: number;
        open_breakers: number;
        ordinary_ceiling: number;
        organization_limit: number;
        paused_projects: number;
        queued_runs: number;
        worker_capacity: number;
        worker_count: number;
      }>("select * from public.portfolio_capacity_overview($1::uuid)", [organizationId]);

      expect(overview.rows[0]).toMatchObject({
        active_runs: 1,
        emergency_reserved: 1,
        focused_projects: 0,
        open_breakers: 0,
        ordinary_ceiling: 2,
        organization_limit: 3,
        paused_projects: 0,
        queued_runs: 1,
        worker_capacity: 2,
        worker_count: 1,
      });

      const projects = await db.query<{
        active_runs: number;
        engineering_priority: number;
        project_name: string;
        queued_runs: number;
      }>("select * from public.portfolio_project_capacity($1::uuid)", [organizationId]);
      // Ordered by priority, so the console reads worst-first without sorting.
      expect(projects.rows.map((row) => row.project_name)).toEqual(["Alpha", "Beta"]);
      expect(projects.rows[0]).toMatchObject({ active_runs: 1, engineering_priority: 2 });
      expect(projects.rows[1]).toMatchObject({ engineering_priority: 3, queued_runs: 1 });
    } finally {
      await db.close();
    }
  });

  it("shows an outsider nothing through the queue and capacity projections", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await submit(db, alpha, "alpha-isolated", "audit", "qa");
      await actAs(db, outsiderId);

      // The projections are SECURITY DEFINER over tables the browser cannot
      // read at all, so membership is the only thing standing between an
      // outsider and another organization's queue.
      const queue = await db.query(
        "select * from public.portfolio_scheduling_queue($1::uuid, 50)", [organizationId],
      );
      const overview = await db.query(
        "select * from public.portfolio_capacity_overview($1::uuid)", [organizationId],
      );
      const projects = await db.query(
        "select * from public.portfolio_project_capacity($1::uuid)", [organizationId],
      );
      expect(queue.rows).toHaveLength(0);
      expect(overview.rows).toHaveLength(0);
      expect(projects.rows).toHaveLength(0);
    } finally {
      await db.close();
    }
  });

  it("keeps the decision log append-only and inside the organization", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 2 });
      await submit(db, alpha, "alpha-rls");
      await registerWorker(db, "portfolio-worker-rls");
      // Without a claim there is nothing to protect, and a row-level trigger on
      // an empty table would let this whole test pass while proving nothing.
      expect(await claim(db, "portfolio-worker-rls")).not.toBeNull();

      await db.exec("reset role");
      await expect(
        db.query("update public.scheduling_decisions set reason = 'rewritten'"),
      ).rejects.toThrow(/append-only/);
      await expect(
        db.query("delete from public.scheduling_decisions"),
      ).rejects.toThrow(/append-only/);

      await actAs(db, outsiderId);
      const outsider = await db.query("select 1 from public.scheduling_decisions");
      expect(outsider.rows).toHaveLength(0);

      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
      await db.exec("set role anon");
      await expect(
        db.query("select 1 from public.scheduling_decisions"),
      ).rejects.toThrow(/permission denied/);
      await db.exec("reset role");

      // service_role runs the worker, and still holds nothing on these tables.
      const grants = await db.query<{ table_name: string }>(
        `select table_name from information_schema.role_table_grants
         where grantee = 'service_role'
           and table_name in ('scheduling_decisions', 'provider_capacity_limits')`,
      );
      expect(grants.rows).toHaveLength(0);
    } finally {
      await db.close();
    }
  });

  it("refuses portfolio controls to anyone who is not an owner", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await actAs(db, outsiderId);

      await expect(
        db.query("select * from public.set_project_engineering_priority($1::uuid,0::smallint,null)", [
          alpha.projectId,
        ]),
      ).rejects.toThrow(/only an organization owner/);
      await expect(
        db.query("select * from public.set_project_engineering_pause($1::uuid,true,$2)", [
          alpha.projectId, "Not mine to pause",
        ]),
      ).rejects.toThrow(/only an organization owner/);
      await expect(
        db.query("select * from public.focus_portfolio_engineering($1::uuid,$2::uuid[],null)", [
          organizationId, [alpha.projectId],
        ]),
      ).rejects.toThrow(/only an organization owner/);
      await expect(
        db.query(
          `select * from public.set_portfolio_capacity_limits(
             $1::uuid,9::smallint,null,null,null,null)`,
          [organizationId],
        ),
      ).rejects.toThrow(/only an organization owner/);
      await expect(
        db.query(
          "select * from public.set_provider_capacity_limit($1::uuid,'openai',9::smallint,null)",
          [organizationId],
        ),
      ).rejects.toThrow(/only an organization owner/);

      // And an owner cannot silently pause without saying why.
      await actAs(db, ownerId);
      await expect(
        db.query("select * from public.set_project_engineering_pause($1::uuid,true,null)", [
          alpha.projectId,
        ]),
      ).rejects.toThrow(/pause reason is required/);
    } finally {
      await db.close();
    }
  });
});

describe("connection loss degrades only the affected project", { timeout: 180_000 }, () => {
  /**
   * Portfolio goal 27, asserted as a negative test rather than inferred from
   * the per-installation isolation Phase 1B proved. The claim path filters on
   * `connection.status = 'connected'` and an active, unsuspended installation,
   * so a lost connection must do exactly two things: withhold the lost
   * project's work, and change nothing about its neighbour.
   */
  it("withholds the lost project's work and leaves the neighbour claimable", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });

      await submit(db, alpha, "alpha-work", "build_feature", "backend");
      await submit(db, beta, "beta-work", "build_feature", "backend");
      await registerWorker(db, "loss-isolation-worker", 2);

      // A server-side discovery marks alpha's connection lost.
      await asWorker(db);
      await db.query(
        "select * from public.mark_github_connection_lost($1::uuid,$2::uuid,$3)",
        [null, alpha.connectionId, "installation_revoked"],
      );

      // Beta claims; alpha's queued run is not offered to anyone.
      const first = await claim(db, "loss-isolation-worker");
      expect(first).not.toBeNull();
      expect(first!.project_id).toBe(beta.projectId);

      const second = await claim(db, "loss-isolation-worker");
      expect(second).toBeNull();

      // The withheld work is still queued — degraded, not destroyed. Recovery
      // needs no resubmission, only a restored connection.
      await db.exec("reset role");
      const alphaRun = await db.query<{ status: string }>(
        `select status::text from public.agent_runs where project_id = $1`,
        [alpha.projectId],
      );
      expect(alphaRun.rows.map((row) => row.status)).toEqual(["queued"]);

      // And the loss is evidence, not just state: the connection reports error.
      const connection = await db.query<{ status: string }>(
        `select status::text from public.connections where id = $1`,
        [alpha.connectionId],
      );
      expect(connection.rows[0].status).toBe("error");
    } finally {
      await db.close();
    }
  });

  it("resumes the withheld project exactly where it was once the connection recovers", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      await submit(db, alpha, "alpha-recovers", "build_feature", "backend");
      await registerWorker(db, "loss-recovery-worker", 2);

      await asWorker(db);
      await db.query(
        "select * from public.mark_github_connection_lost($1::uuid,$2::uuid,$3)",
        [null, alpha.connectionId, "provider_authorization_failed"],
      );
      expect(await claim(db, "loss-recovery-worker")).toBeNull();

      // Reconnection restores the connection, installation, and repository
      // selection — the loss function de-selects repositories, and a real
      // resync (`reconcile_github_repository_grants`) re-selects them. None of
      // it touches the queue, so the same run becomes claimable without
      // resubmission.
      await db.exec("reset role");
      await db.query(
        `update public.connections set status = 'connected' where id = $1`,
        [alpha.connectionId],
      );
      await db.query(
        `update public.github_installations
         set status = 'active', suspended_at = null where connection_id = $1`,
        [alpha.connectionId],
      );
      await db.query(
        `update public.github_repositories set selected = true
         where installation_id = $1`,
        [alpha.installationId],
      );

      const reclaimed = await claim(db, "loss-recovery-worker");
      expect(reclaimed).not.toBeNull();
      expect(reclaimed!.project_id).toBe(alpha.projectId);
    } finally {
      await db.close();
    }
  });
});

describe("archive preserves history and stops new work", { timeout: 180_000 }, () => {
  /**
   * Portfolio goal 28. Archive existed only as an enum value — nothing could
   * set it, so "archive preserves history" was unfalsifiable. Now that it is
   * an operation, the claim is tested the only way it means anything: archive
   * a project that has real queued work and real history, and show the work
   * stops, the history stays, and unarchiving resumes exactly where it was.
   */
  it("archives, withholds, preserves, and resumes", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      await submit(db, alpha, "alpha-history", "build_feature", "backend");
      await submit(db, beta, "beta-open", "build_feature", "backend");
      await registerWorker(db, "archive-worker", 2);

      // A non-owner cannot archive, and the refusal names the rule.
      await actAs(db, outsiderId);
      await expect(
        db.query("select * from public.archive_project($1::uuid,$2)", [
          alpha.projectId, "tidying up",
        ]),
      ).rejects.toThrow(/organization owner/);

      // An owner cannot archive silently.
      await actAs(db, ownerId);
      await expect(
        db.query("select * from public.archive_project($1::uuid,null)", [alpha.projectId]),
      ).rejects.toThrow(/reason is required/);

      const archived = await db.query<{ status: string }>(
        "select status::text from public.archive_project($1::uuid,$2)",
        [alpha.projectId, "Superseded by the beta rewrite"],
      );
      expect(archived.rows[0].status).toBe("archived");

      // New work stops: only beta's run is offered.
      const first = await claim(db, "archive-worker");
      expect(first).not.toBeNull();
      expect(first!.project_id).toBe(beta.projectId);
      expect(await claim(db, "archive-worker")).toBeNull();

      // History stays: the queued run, its task and command keep their rows,
      // and the archive itself is an immutable activity event with the reason.
      await db.exec("reset role");
      const history = await db.query<{ runs: number; tasks: number; commands: number }>(
        `select
           (select count(*)::int from public.agent_runs where project_id = $1) as runs,
           (select count(*)::int from public.tasks where project_id = $1) as tasks,
           (select count(*)::int from public.commands where project_id = $1) as commands`,
        [alpha.projectId],
      );
      expect(history.rows[0]).toEqual({ runs: 1, tasks: 1, commands: 1 });

      const event = await db.query<{ metadata: { reason?: string } }>(
        `select metadata from public.activity_events
         where project_id = $1 and event_type = 'project.archived'`,
        [alpha.projectId],
      );
      expect(event.rows).toHaveLength(1);
      expect(event.rows[0].metadata.reason).toBe("Superseded by the beta rewrite");

      // Unarchive restores to active and the same queued run becomes claimable
      // with no resubmission — the history was the work, and it survived.
      await actAs(db, ownerId);
      const restored = await db.query<{ status: string }>(
        "select status::text from public.unarchive_project($1::uuid,$2)",
        [alpha.projectId, "Beta rewrite cancelled"],
      );
      expect(restored.rows[0].status).toBe("active");

      const reclaimed = await claim(db, "archive-worker");
      expect(reclaimed).not.toBeNull();
      expect(reclaimed!.project_id).toBe(alpha.projectId);
    } finally {
      await db.close();
    }
  });

  it("refuses to archive twice and to unarchive the unarchived", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await actAs(db, ownerId);
      await expect(
        db.query("select * from public.unarchive_project($1::uuid,null)", [alpha.projectId]),
      ).rejects.toThrow(/not archived/);

      await db.query("select * from public.archive_project($1::uuid,$2)", [
        alpha.projectId, "First archive",
      ]);
      await expect(
        db.query("select * from public.archive_project($1::uuid,$2)", [
          alpha.projectId, "Second archive",
        ]),
      ).rejects.toThrow(/already archived/);
    } finally {
      await db.close();
    }
  });
});

describe("the daily report carries the per-project view", { timeout: 180_000 }, () => {
  /**
   * Portfolio goal 26. The report was organization-wide with a health
   * histogram and attributed risks — and a healthy project had no row
   * anywhere, so "how is this project" had no answer for the majority. The
   * projects array closes that, and this asserts the property that makes it
   * a portfolio report: every project appears, healthy and archived included.
   */
  it("gives every project a row, with counts matching the tables", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      await submit(db, alpha, "alpha-open", "build_feature", "backend");

      await actAs(db, ownerId);
      await db.query("select * from public.archive_project($1::uuid,$2)", [
        beta.projectId, "Report coverage test",
      ]);

      const generated = await db.query<{ content: { policy_version: string; projects: readonly {
        project_id: string; status: string; open_runs: number; open_tasks: number;
      }[] } }>(
        "select content from public.generate_operations_report($1::uuid, 24)",
        [organizationId],
      );
      const content = generated.rows[0].content;
      expect(content.policy_version).toBe("phase1e-operations-v2");

      const rows = new Map(content.projects.map((row) => [row.project_id, row]));
      // Both projects present: the healthy-and-busy one and the archived one.
      expect(rows.size).toBe(2);
      expect(rows.get(alpha.projectId)).toMatchObject({ open_runs: 1, open_tasks: 1 });
      expect(rows.get(beta.projectId)).toMatchObject({ status: "archived" });
    } finally {
      await db.close();
    }
  });
});

describe("projects cannot be deleted, and the schema is why", { timeout: 180_000 }, () => {
  /**
   * Portfolio goal 29, resolved by discovery rather than construction. Every
   * project is born with a 'project.created' activity event; activity_events
   * references projects with ON DELETE RESTRICT; and the append-only trigger
   * makes the birth record permanent. A project's audit trail is literally
   * what makes it undeletable, from its first moment. The new trigger only
   * *names* that rule before the constraint fires.
   */
  it("refuses deletion with instructions, even for the most privileged role", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await db.exec("reset role");

      await expect(
        db.query("delete from public.projects where id = $1", [alpha.projectId]),
      ).rejects.toThrow(/archive_project/);

      const survivor = await db.query<{ count: number }>(
        "select count(*)::int as count from public.projects where id = $1",
        [alpha.projectId],
      );
      expect(survivor.rows[0].count).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("holds even without the trigger, because the birth record restricts", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await db.exec("reset role");

      // The direct seed insert still fired projects_audit_change: the project
      // was born with history.
      const birth = await db.query<{ count: number }>(
        `select count(*)::int as count from public.activity_events
         where project_id = $1 and event_type = 'project.created'`,
        [beta.projectId],
      );
      expect(birth.rows[0].count).toBe(1);

      // Drop the instructive trigger and try again: the RESTRICT constraint
      // is the deeper lock, and the trail itself cannot be cleared first —
      // activity_events is append-only.
      await db.exec("drop trigger projects_guarded_deletion on public.projects");
      await expect(
        db.query("delete from public.projects where id = $1", [beta.projectId]),
      ).rejects.toThrow(/activity_events/);
      await expect(
        db.query("delete from public.activity_events where project_id = $1", [beta.projectId]),
      ).rejects.toThrow(/append-only|immutable/i);
    } finally {
      await db.close();
    }
  });
});

describe("an agent's context is exactly one project", { timeout: 180_000 }, () => {
  /**
   * Portfolio goal 31. The row returned by `claim_phase1c_run` is the entire
   * context a worker receives — there is no second channel — so isolation is
   * provable at that one boundary. Two claims follow: every identifier in the
   * payload belongs to the claimed project and none to its sibling, and the
   * lease the payload carries authorises nothing against the sibling's run.
   * The payload's column list is pinned because any new context field is a
   * new place a sibling could leak, and must re-answer this test's question.
   */
  it("hands the worker only the claimed project's identifiers, and pins the payload shape", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      await submit(db, alpha, "alpha-context", "build_feature", "backend");
      await submit(db, beta, "beta-context", "build_feature", "backend");
      await registerWorker(db, "context-worker", 1);

      await asWorker(db);
      const { rows } = await db.query<Record<string, unknown>>(
        "select * from public.claim_phase1c_run($1,$2,$3,$4)",
        ["context-worker", "openai", "gpt-5.3-codex", 120],
      );
      const payload = rows[0];
      expect(payload).toBeDefined();

      // Which project won the claim is the scheduler's business, not this
      // test's. Whichever it was, the payload must be entirely that project's.
      const claimed = payload.project_id === alpha.projectId ? alpha : beta;
      const sibling = claimed === alpha ? beta : alpha;
      expect(payload.project_id).toBe(claimed.projectId);
      expect(payload.connection_id).toBe(claimed.connectionId);
      expect(payload.repository_id).toBe(claimed.repositoryId);
      expect(payload.internal_installation_id).toBe(claimed.installationId);
      expect(Number(payload.external_installation_id)).toBe(claimed.externalInstallationId);
      expect(Number(payload.external_repository_id)).toBe(claimed.externalRepositoryId);
      expect(payload.repository_full_name).toBe(claimed.repository);

      // Nothing of the sibling leaks through any field — not its ids, not its
      // repository, not even its name in the prompt.
      const serialized = JSON.stringify(payload, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      for (const leaked of [
        sibling.projectId, sibling.connectionId, sibling.repositoryId,
        sibling.installationId, sibling.repository, sibling.name,
        String(sibling.externalInstallationId), String(sibling.externalRepositoryId),
      ]) {
        expect(serialized).not.toContain(leaked);
      }

      // The worker's whole world, by column name. A field added here without
      // updating this pin is a field nobody asked the leak question about.
      expect(Object.keys(payload).sort()).toEqual([
        "acceptance_criteria", "agent_id", "app_id", "attempt_number",
        "base_branch", "base_sha", "cancellation_requested", "ci_timeout_ms",
        "command_id", "command_type", "connection_id",
        "external_installation_id", "external_repository_id",
        "internal_installation_id", "lease_expires_at", "lease_token",
        "logical_agent_role", "maximum_duration_ms", "maximum_input_tokens",
        "maximum_output_tokens", "maximum_repair_attempts", "maximum_turns",
        "model", "organization_id", "owner_approval_expires_at",
        "owner_approval_id", "plan", "project_id", "prompt", "provider",
        "recovery_head_branch", "recovery_head_sha",
        "recovery_provider_run_reference", "recovery_pull_request_number",
        "recovery_pull_request_url", "recovery_usage", "repository_full_name",
        "repository_id", "requested_risk", "run_id", "task_id",
      ]);
    } finally {
      await db.close();
    }
  });

  it("refuses one project's lease against the sibling's running run", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      await submit(db, alpha, "alpha-lease", "build_feature", "backend");
      await submit(db, beta, "beta-lease", "build_feature", "backend");
      await registerWorker(db, "lease-worker-a", 1);
      await registerWorker(db, "lease-worker-b", 1);

      const first = await claim(db, "lease-worker-a");
      const second = await claim(db, "lease-worker-b");
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(new Set([first!.project_id, second!.project_id])).toEqual(
        new Set([alpha.projectId, beta.projectId]),
      );

      // Worker A holds a perfectly valid lease — on its own run. Against the
      // sibling's running run, that lease is worth nothing.
      await asWorker(db);
      await expect(
        db.query(
          "select * from public.heartbeat_phase1c_run($1,$2::uuid,$3::uuid,120)",
          ["lease-worker-a", second!.run_id, first!.lease_token],
        ),
      ).rejects.toThrow(/run deadline is missing or expired/);
      await expect(
        db.query(
          `select * from public.complete_phase1c_run(
             $1,$2::uuid,$3::uuid,'failed','Cross-project completion attempt.',null,
             '{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'cross_project_attempt',
             'This call must never succeed.',false)`,
          ["lease-worker-a", second!.run_id, first!.lease_token],
        ),
      ).rejects.toThrow(/active run lease required/);

      // The refusal was about identity, not both calls being broken: the
      // sibling's run is untouched and its rightful worker can still act.
      await db.exec("reset role");
      const untouched = await db.query<{ lease_worker_id: string; status: string }>(
        "select status::text, lease_worker_id from public.agent_runs where id = $1",
        [second!.run_id],
      );
      expect(untouched.rows[0]).toMatchObject({
        lease_worker_id: "lease-worker-b", status: "running",
      });
      await finish(db, "lease-worker-b", second!);

      await db.exec("reset role");
      const finished = await db.query<{ status: string }>(
        "select status::text from public.agent_runs where id = $1",
        [second!.run_id],
      );
      expect(finished.rows[0].status).toBe("failed");
    } finally {
      await db.close();
    }
  });
});

describe("cross-project work exists only through an explicit dependency", { timeout: 180_000 }, () => {
  /**
   * Portfolio goal 17. Half of this rule has held since Phase 1C:
   * `submit_command` refuses dependency IDs outside the command's own project,
   * so implicit coupling is impossible. And the claim gate joins prerequisites
   * by organization, not project — the scheduler was always ready to respect a
   * cross-project edge. `declare_cross_project_dependency` is the authorized
   * doorway that can finally create one, and these tests prove the whole arc:
   * declared coupling withholds the dependent, honest completion releases it,
   * every dishonest declaration is refused by name, release restores the
   * dependent without touching submission evidence, and an idempotent replay
   * of the originating command survives a coupling declared after it.
   */
  it("withholds the dependent project's work until the prerequisite completes", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      const prerequisite = await submit(db, alpha, "coupling-prerequisite", "build_feature", "backend");
      const dependent = await submit(db, beta, "coupling-dependent", "build_feature", "backend");

      await declareDependency(
        db, dependent.task_id, prerequisite.task_id,
        "Beta consumes the API Alpha is about to publish.",
      );

      // The coupling is visible from both sides, with the reason attached.
      await db.exec("reset role");
      const events = await db.query<{ project_id: string; metadata: { reason: string } }>(
        `select project_id, metadata from public.activity_events
         where event_type = 'task.cross_project_dependency_declared' order by created_at`,
      );
      expect(events.rows.map((row) => row.project_id).sort()).toEqual(
        [alpha.projectId, beta.projectId].sort(),
      );
      for (const row of events.rows) {
        expect(row.metadata.reason).toBe("Beta consumes the API Alpha is about to publish.");
      }

      await registerWorker(db, "coupling-worker", 2);

      // Beta's run exists and is queued, but the portfolio offers only Alpha.
      const first = await claim(db, "coupling-worker");
      expect(first).not.toBeNull();
      expect(first!.project_id).toBe(alpha.projectId);
      const withheld = await claim(db, "coupling-worker");
      expect(withheld).toBeNull();

      // The prerequisite finishes honestly; the gate lifts on real evidence.
      await succeed(db, "coupling-worker", first!, alpha, 41);
      const released = await claim(db, "coupling-worker");
      expect(released).not.toBeNull();
      expect(released!.project_id).toBe(beta.projectId);
      expect(released!.task_id).toBe(dependent.task_id);

      // Declaring against already-finished work would gate nothing, and the
      // boundary says so instead of recording a dead edge.
      const late = await submit(db, beta, "coupling-late", "build_feature", "backend");
      await expect(
        declareDependency(db, late.task_id, prerequisite.task_id, "Too late to matter."),
      ).rejects.toThrow(/already complete/);
    } finally {
      await db.close();
    }
  });

  it("refuses every dishonest declaration by name", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      const alphaFirst = await submit(db, alpha, "refusals-alpha-1", "build_feature", "backend");
      const alphaSecond = await submit(db, alpha, "refusals-alpha-2", "build_feature", "frontend");
      const betaFirst = await submit(db, beta, "refusals-beta-1", "build_feature", "backend");

      // No reason, no coupling.
      await expect(
        declareDependency(db, betaFirst.task_id, alphaSecond.task_id, null),
      ).rejects.toThrow(/dependency reason is required/);
      await expect(
        declareDependency(db, betaFirst.task_id, alphaSecond.task_id, "   "),
      ).rejects.toThrow(/dependency reason is required/);

      // A task cannot wait on itself.
      await expect(
        declareDependency(db, betaFirst.task_id, betaFirst.task_id, "Self-referential."),
      ).rejects.toThrow(/cannot depend on itself/);

      // Same-project pairs belong to submission, and the refusal says where.
      await expect(
        declareDependency(db, alphaSecond.task_id, alphaFirst.task_id, "Wrong doorway."),
      ).rejects.toThrow(/declared at submission/);

      // An outsider learns nothing: not ownership, not existence.
      await actAs(db, outsiderId);
      await expect(
        db.query(
          "select * from public.declare_cross_project_dependency($1::uuid,$2::uuid,$3)",
          [betaFirst.task_id, alphaSecond.task_id, "Not my portfolio."],
        ),
      ).rejects.toThrow(/task not found/);

      // Duplicates are refused, not silently absorbed.
      await declareDependency(
        db, betaFirst.task_id, alphaSecond.task_id, "Beta waits on Alpha's frontend work.",
      );
      await expect(
        declareDependency(db, betaFirst.task_id, alphaSecond.task_id, "Again."),
      ).rejects.toThrow(/already declared/);

      // The reverse edge would deadlock both projects; refused before it can.
      await expect(
        declareDependency(db, alphaSecond.task_id, betaFirst.task_id, "Mutual dependence."),
      ).rejects.toThrow(/create a cycle/);

      // A prerequisite that already failed will never complete, and a
      // dependency on it would block forever. The worker fails Alpha's first
      // task for real, then the boundary refuses it as a prerequisite.
      await registerWorker(db, "refusals-worker", 1);
      const claimed = await claim(db, "refusals-worker");
      expect(claimed).not.toBeNull();
      expect(claimed!.task_id).toBe(alphaFirst.task_id);
      await finish(db, "refusals-worker", claimed!);
      const late = await submit(db, beta, "refusals-beta-2", "build_feature", "frontend");
      await expect(
        declareDependency(db, late.task_id, alphaFirst.task_id, "Waiting on failed work."),
      ).rejects.toThrow(/will never complete/);
    } finally {
      await db.close();
    }
  });

  it("releases the coupling on demand, but never touches submission evidence", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      const alphaFirst = await submit(db, alpha, "release-alpha-1", "build_feature", "backend");
      const alphaSecond = await submit(
        db, alpha, "release-alpha-2", "build_feature", "frontend", [alphaFirst.task_id],
      );
      const betaFirst = await submit(db, beta, "release-beta-1", "build_feature", "backend");

      await declareDependency(
        db, betaFirst.task_id, alphaFirst.task_id, "Beta ships after Alpha's foundation.",
      );

      // Both dependents are withheld: Alpha's second task by its submission
      // edge, Beta's task by the declared coupling. Only the prerequisite runs.
      await registerWorker(db, "release-worker", 3);
      const first = await claim(db, "release-worker");
      expect(first).not.toBeNull();
      expect(first!.task_id).toBe(alphaFirst.task_id);
      expect(await claim(db, "release-worker")).toBeNull();

      // Releasing the declared coupling frees Beta immediately — no completion
      // required — and both projects record why.
      await releaseDependency(
        db, betaFirst.task_id, alphaFirst.task_id,
        "Beta's consumer moved to the published contract; the wait is obsolete.",
      );
      const freed = await claim(db, "release-worker");
      expect(freed).not.toBeNull();
      expect(freed!.task_id).toBe(betaFirst.task_id);

      await db.exec("reset role");
      const releaseEvents = await db.query<{ project_id: string }>(
        `select project_id from public.activity_events
         where event_type = 'task.cross_project_dependency_released'`,
      );
      expect(releaseEvents.rows.map((row) => row.project_id).sort()).toEqual(
        [alpha.projectId, beta.projectId].sort(),
      );

      // Alpha's submission edge is not this control's to release.
      await expect(
        releaseDependency(db, alphaSecond.task_id, alphaFirst.task_id, "Trying anyway."),
      ).rejects.toThrow(/submission evidence/);
      // And a coupling that does not exist is not found, not invented.
      await expect(
        releaseDependency(db, betaFirst.task_id, alphaFirst.task_id, "Releasing twice."),
      ).rejects.toThrow(/dependency not found/);
    } finally {
      await db.close();
    }
  });

  it("keeps idempotent replays honest after a coupling is declared", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });
      const prerequisite = await submit(db, alpha, "replay-alpha", "build_feature", "backend");

      // Submission still refuses an implicit cross-project dependency with its
      // deliberately generic error — the carried-forward body did not soften.
      await actAs(db, ownerId);
      await expect(
        db.query(
          "select command_id from public.submit_command($1,$2,$3,$4::jsonb,$5)",
          [
            beta.projectId, "Improve the Beta dashboard copy.", "green",
            JSON.stringify(commandParameters(beta, "build_feature", "backend", [prerequisite.task_id])),
            "replay-implicit",
          ],
        ),
      ).rejects.toThrow(/invalid command dependencies/);

      // A dependent command submitted, then coupled, then replayed with the
      // same idempotency key: the replay succeeds, because the cross-project
      // edge is declaration evidence, not unexplained submission evidence.
      const dependent = await submit(db, beta, "replay-beta", "build_feature", "backend");
      await declareDependency(
        db, dependent.task_id, prerequisite.task_id, "Declared between submit and replay.",
      );
      const replayed = await submit(db, beta, "replay-beta", "build_feature", "backend");
      expect(replayed.command_id).toBe(dependent.command_id);
      expect(replayed.task_id).toBe(dependent.task_id);

      // The declared edge survived the replay untouched.
      await db.exec("reset role");
      const edge = await db.query<{ count: number }>(
        `select count(*)::int as count from public.task_dependencies
         where task_id = $1 and depends_on_task_id = $2`,
        [dependent.task_id, prerequisite.task_id],
      );
      expect(edge.rows[0].count).toBe(1);
    } finally {
      await db.close();
    }
  });
});

describe("a connection-specific ceiling binds one account, not the portfolio", { timeout: 180_000 }, () => {
  /**
   * 2D goal 31, proven at the boundary that enforces it. The verdict's
   * connection-level branch was the one ceiling no test exercised: a
   * `provider_capacity_limits` row naming a connection caps work bound to
   * that connection at claim time, counted live from running runs with
   * unexpired leases — while the neighbour project's own connection keeps
   * working and the capped work stays queued, starting the moment the
   * connection's slot frees.
   */
  it("withholds work at the connection's ceiling and releases it with capacity", async () => {
    const db = await database();
    try {
      await seedPortfolio(db);
      await setLimits(db, { emergencyReserved: 0, global: 4 });

      await actAs(db, ownerId);
      await db.query(
        "select * from public.set_provider_capacity_limit($1::uuid,'openai',1::smallint,$2::uuid)",
        [organizationId, alpha.connectionId],
      );

      const alphaFirst = await submit(db, alpha, "conn-ceiling-a1", "build_feature", "backend");
      const alphaSecond = await submit(db, alpha, "conn-ceiling-a2", "build_feature", "frontend");
      const betaFirst = await submit(db, beta, "conn-ceiling-b1", "build_feature", "backend");
      await registerWorker(db, "conn-ceiling-worker", 3);

      // Alpha's first run occupies the connection's single slot.
      const first = await claim(db, "conn-ceiling-worker");
      expect(first).not.toBeNull();
      expect(first!.task_id).toBe(alphaFirst.task_id);

      // Alpha's second task is older than Beta's, but its connection is at
      // ceiling — the scheduler passes over it and hands out Beta's work.
      const second = await claim(db, "conn-ceiling-worker");
      expect(second).not.toBeNull();
      expect(second!.task_id).toBe(betaFirst.task_id);
      expect(await claim(db, "conn-ceiling-worker")).toBeNull();

      // The pass-over is audited with the ceiling that caused it.
      await db.exec("reset role");
      const withheld = await db.query<{ reason: string }>(
        `select reason from public.scheduling_decisions
         where decision = 'withheld' and project_id = $1`,
        [alpha.projectId],
      );
      expect(
        withheld.rows.some((row) => row.reason.includes("Connection is at its concurrency ceiling")),
      ).toBe(true);

      // Releasing the slot releases exactly the capped work.
      await finish(db, "conn-ceiling-worker", first!);
      const freed = await claim(db, "conn-ceiling-worker");
      expect(freed).not.toBeNull();
      expect(freed!.task_id).toBe(alphaSecond.task_id);
    } finally {
      await db.close();
    }
  });
});
