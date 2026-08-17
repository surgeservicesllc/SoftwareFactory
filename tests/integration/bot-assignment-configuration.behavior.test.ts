// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Many bots on one project, each configured independently — against the real
 * migrated schema rather than a mock, because the guarantees that matter here
 * are the database's: the batch is atomic, authority is nested, elevated grants
 * keep their human, and a member cannot write any of it directly.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000ba01";
const memberId = "00000000-0000-4000-8000-00000000ba02";
const outsiderId = "00000000-0000-4000-8000-00000000ba03";
const organizationId = "10000000-0000-4000-8000-00000000ba01";
const otherOrganizationId = "10000000-0000-4000-8000-00000000ba02";

async function assumeRole(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

type AssignmentRow = {
  id: string;
  bot_id: string;
  project_id: string;
  role_id: string;
  status: string;
  preset: string | null;
  responsibilities: string[];
  instructions: string | null;
  repository_access: string;
  branch_strategy: string;
  can_open_pull_request: boolean;
  can_merge_pull_request: boolean;
  pipeline_access: string;
  environment_access: string;
  tools: string[];
  requires_human_approval: boolean;
  max_concurrent_tasks: number;
  priority: number;
  released_at: string | null;
};

describe("assigning several configured bots to one project", { timeout: 240_000 }, () => {
  let db: PGlite;
  const bots: Record<string, string> = {};
  const roles: Record<string, string> = {};
  let projectId: string;
  let secondProjectId: string;

  /** Assigns as the owner and returns the rows the function produced. */
  async function assign(
    targetProjectId: string,
    entries: ReadonlyArray<Record<string, unknown>>,
    actor: string = ownerId,
  ) {
    await assumeRole(db, actor);
    try {
      const result = await db.query<AssignmentRow>(
        "select * from public.assign_bots_to_project($1::uuid, $2::uuid, $3::jsonb)",
        [organizationId, targetProjectId, JSON.stringify(entries)],
      );
      return result.rows;
    } finally {
      await resetRole(db);
    }
  }

  async function openPostings(targetProjectId: string) {
    const result = await db.query<AssignmentRow>(
      `select * from public.bot_assignments
       where project_id = $1::uuid and status <> 'released'
       order by priority, assigned_at`,
      [targetProjectId],
    );
    return result.rows;
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const files = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-assign', '${ownerId}'),
             ('${otherOrganizationId}', 'Elsewhere', 'elsewhere-assign', '${outsiderId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
    `);

    const project = await db.query<{ id: string }>(
      `insert into public.projects (organization_id, name, created_by)
       values ($1::uuid, 'E-Commerce Platform', $2::uuid) returning id`,
      [organizationId, ownerId],
    );
    projectId = project.rows[0].id;
    const second = await db.query<{ id: string }>(
      `insert into public.projects (organization_id, name, created_by)
       values ($1::uuid, 'Mobile App', $2::uuid) returning id`,
      [organizationId, ownerId],
    );
    secondProjectId = second.rows[0].id;

    await assumeRole(db, ownerId);
    for (const [key, name] of [
      ["codeMaster", "Code Master"],
      ["testEngineer", "Test Engineer"],
      ["securityGuardian", "Security Guardian"],
      ["docsWriter", "Docs Writer"],
      ["managed", "Managed Bot"],
    ] as const) {
      const created = await db.query<{ id: string }>(
        `select id from public.register_bot(
           $1::uuid, $2, 'anthropic'::public.bot_provider, 'claude-opus-5',
           'ANTHROPIC_API_KEY', null, null
         )`,
        [organizationId, name],
      );
      bots[key] = created.rows[0].id;
    }

    for (const [key, name, slug] of [
      ["developer", "Developer", "developer"],
      ["tester", "Tester", "tester"],
      ["security", "Security Reviewer", "security-reviewer"],
    ] as const) {
      const created = await db.query<{ id: string }>(
        `select id from public.save_bot_role(
           $1::uuid, null, $2, $3, 'Builds and ships changes.',
           'Work only inside the assigned project.', 'green'::public.risk_level, '[]'::jsonb
         )`,
        [organizationId, name, slug],
      );
      roles[key] = created.rows[0].id;
    }
    await resetRole(db);

    // `disabled` is the durable "do not give this work" state. It is reached
    // through a readiness check, not through retiring — `retire_bot` deletes
    // the row outright, so a retired bot is absent rather than disabled.
    await assumeRole(db, ownerId);
    const disabled = await db.query<{ id: string }>(
      `select id from public.register_bot(
         $1::uuid, 'Disabled Bot', 'anthropic'::public.bot_provider, 'claude-opus-5',
         'ANTHROPIC_API_KEY', null, null
       )`,
      [organizationId],
    );
    bots.disabled = disabled.rows[0].id;
    await db.query(
      `select public.record_bot_readiness(
         $1::uuid, $2::uuid, 'disabled'::public.bot_readiness, 'Turned off by the owner.'
       )`,
      [organizationId, bots.disabled],
    );
    await resetRole(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("assigns three differently configured bots in one call", async () => {
    const rows = await assign(projectId, [
      {
        bot_id: bots.codeMaster,
        role_id: roles.developer,
        preset: "developer",
        responsibilities: ["Implement features", "Fix defects"],
        repository_access: "write",
        can_open_pull_request: true,
        pipeline_access: "all",
        max_concurrent_tasks: 3,
        priority: 1,
      },
      {
        bot_id: bots.testEngineer,
        role_id: roles.tester,
        preset: "tester",
        responsibilities: ["Write tests"],
        repository_access: "write",
        can_open_pull_request: true,
        pipeline_access: "all",
        priority: 2,
      },
      {
        bot_id: bots.securityGuardian,
        role_id: roles.security,
        preset: "security",
        responsibilities: ["Scan for vulnerabilities"],
        repository_access: "read",
        pipeline_access: "assigned",
        priority: 0,
      },
    ]);

    expect(rows).toHaveLength(3);

    const postings = await openPostings(projectId);
    expect(postings.map((row) => row.bot_id).sort()).toEqual(
      [bots.codeMaster, bots.testEngineer, bots.securityGuardian].sort(),
    );

    // Each bot kept its own configuration — the whole point of assigning
    // several rather than one. A shared default would pass a "three rows"
    // assertion and be useless.
    const guardian = postings.find((row) => row.bot_id === bots.securityGuardian)!;
    const coder = postings.find((row) => row.bot_id === bots.codeMaster)!;
    expect(guardian.repository_access).toBe("read");
    expect(guardian.can_open_pull_request).toBe(false);
    expect(guardian.pipeline_access).toBe("assigned");
    expect(guardian.priority).toBe(0);
    expect(coder.repository_access).toBe("write");
    expect(coder.can_open_pull_request).toBe(true);
    expect(coder.max_concurrent_tasks).toBe(3);
    expect(coder.responsibilities).toEqual(["Implement features", "Fix defects"]);
  });

  it("writes one activity event per bot, naming the permissions granted", async () => {
    const events = await db.query<{ event_type: string; metadata: Record<string, unknown> }>(
      `select event_type, metadata from public.activity_events
       where project_id = $1::uuid and entity_type = 'bot_assignment'
       order by created_at`,
      [projectId],
    );

    expect(events.rows.length).toBeGreaterThanOrEqual(3);
    const assigned = events.rows.filter((row) => row.event_type === "bot.assigned");
    expect(assigned).toHaveLength(3);
    // The audit record has to carry what was granted, or it cannot answer the
    // only question anyone asks it later.
    expect(assigned.every((row) => "repository_access" in row.metadata)).toBe(true);
    expect(assigned.every((row) => row.metadata.executor_connected === false)).toBe(true);
  });

  it("defaults an unconfigured bot to least privilege", async () => {
    await assign(secondProjectId, [{ bot_id: bots.docsWriter, role_id: roles.developer }]);

    const [posting] = await openPostings(secondProjectId);
    expect(posting).toMatchObject({
      repository_access: "read",
      branch_strategy: "per_task_branch",
      can_open_pull_request: false,
      can_merge_pull_request: false,
      pipeline_access: "none",
      environment_access: "none",
      requires_human_approval: true,
      max_concurrent_tasks: 1,
      priority: 2,
    });
  });

  it("reconfigures rather than duplicating when the same bot is assigned again", async () => {
    await assign(projectId, [
      {
        bot_id: bots.codeMaster,
        role_id: roles.developer,
        repository_access: "write",
        can_open_pull_request: true,
        max_concurrent_tasks: 5,
      },
    ]);

    const postings = await openPostings(projectId);
    expect(postings.filter((row) => row.bot_id === bots.codeMaster)).toHaveLength(1);
    expect(postings.find((row) => row.bot_id === bots.codeMaster)?.max_concurrent_tasks).toBe(5);
  });

  it("moves a bot rather than posting it twice, and says so in the event", async () => {
    await assign(secondProjectId, [{ bot_id: bots.testEngineer, role_id: roles.tester }]);

    // One open posting per bot is the invariant; the move must be visible.
    const everywhere = await db.query<{ count: string }>(
      `select count(*) from public.bot_assignments
       where bot_id = $1::uuid and status <> 'released'`,
      [bots.testEngineer],
    );
    expect(Number(everywhere.rows[0].count)).toBe(1);

    const moved = await db.query<{ metadata: Record<string, unknown> }>(
      `select metadata from public.activity_events
       where event_type = 'bot.moved' and entity_type = 'bot_assignment'
       order by created_at desc limit 1`,
    );
    expect(moved.rows[0].metadata.previous_project_id).toBe(projectId);

    // Put it back so later cases start from the documented roster.
    await assign(projectId, [{ bot_id: bots.testEngineer, role_id: roles.tester }]);
  });

  it("refuses the whole batch when one bot is invalid, leaving nothing behind", async () => {
    const before = await openPostings(secondProjectId);

    await expect(
      assign(secondProjectId, [
        { bot_id: bots.securityGuardian, role_id: roles.security },
        { bot_id: "00000000-0000-4000-8000-0000000000ff", role_id: roles.developer },
      ]),
    ).rejects.toThrow(/bot was not found/i);

    // Atomicity is the reason the batch exists. A half-staffed project is
    // worse than a refused request, because nobody can tell which half landed.
    const after = await openPostings(secondProjectId);
    expect(after.map((row) => row.bot_id).sort()).toEqual(before.map((row) => row.bot_id).sort());
  });

  it("refuses the same bot twice in one payload instead of letting the last win", async () => {
    await expect(
      assign(projectId, [
        { bot_id: bots.docsWriter, role_id: roles.developer, repository_access: "read" },
        { bot_id: bots.docsWriter, role_id: roles.tester, repository_access: "write" },
      ]),
    ).rejects.toThrow(/more than once/i);
  });

  it("refuses a disabled bot", async () => {
    await expect(
      assign(projectId, [{ bot_id: bots.disabled, role_id: roles.developer }]),
    ).rejects.toThrow(/disabled bot cannot be assigned/i);
  });

  it("refuses an archived project", async () => {
    const archived = await db.query<{ id: string }>(
      `insert into public.projects (organization_id, name, status, created_by)
       values ($1::uuid, 'Sunset', 'archived'::public.project_status, $2::uuid) returning id`,
      [organizationId, ownerId],
    );

    await expect(
      assign(archived.rows[0].id, [{ bot_id: bots.docsWriter, role_id: roles.developer }]),
    ).rejects.toThrow(/project was not found/i);
  });

  it("refuses an empty selection and an oversized one", async () => {
    await expect(assign(projectId, [])).rejects.toThrow(/at least one bot/i);
    await expect(
      assign(
        projectId,
        Array.from({ length: 26 }, () => ({ bot_id: bots.docsWriter, role_id: roles.developer })),
      ),
    ).rejects.toThrow(/at most 25 bots/i);
  });

  describe("authority is nested rather than advisory", () => {
    it("refuses opening pull requests without repository write", async () => {
      await expect(
        assign(projectId, [
          {
            bot_id: bots.docsWriter,
            role_id: roles.developer,
            repository_access: "read",
            can_open_pull_request: true,
          },
        ]),
      ).rejects.toThrow(/bot_assignments_authority_nested/);
    });

    it("refuses merging without being able to open", async () => {
      await expect(
        assign(projectId, [
          {
            bot_id: bots.docsWriter,
            role_id: roles.developer,
            repository_access: "write",
            can_open_pull_request: false,
            can_merge_pull_request: true,
            requires_human_approval: true,
          },
        ]),
      ).rejects.toThrow(/bot_assignments_authority_nested/);
    });

    it("refuses merge authority that waives human approval", async () => {
      // policies/AUTO_MERGE_POLICY.md gives Phase 1 no autonomous merge
      // authority. A stored row must not be able to imply it has one.
      await expect(
        assign(projectId, [
          {
            bot_id: bots.docsWriter,
            role_id: roles.developer,
            repository_access: "write",
            can_open_pull_request: true,
            can_merge_pull_request: true,
            requires_human_approval: false,
          },
        ]),
      ).rejects.toThrow(/bot_assignments_elevated_requires_approval/);
    });

    it("refuses production access that waives human approval", async () => {
      await expect(
        assign(projectId, [
          {
            bot_id: bots.docsWriter,
            role_id: roles.developer,
            environment_access: "production",
            requires_human_approval: false,
          },
        ]),
      ).rejects.toThrow(/bot_assignments_elevated_requires_approval/);
    });

    it("accepts merge authority that keeps its human", async () => {
      const rows = await assign(projectId, [
        {
          bot_id: bots.docsWriter,
          role_id: roles.developer,
          repository_access: "write",
          can_open_pull_request: true,
          can_merge_pull_request: true,
          requires_human_approval: true,
        },
      ]);

      expect(rows[0]).toMatchObject({
        can_merge_pull_request: true,
        requires_human_approval: true,
      });
    });
  });

  describe("bounds on what a browser-readable row may contain", () => {
    // Secret-shaped text is caught by the `reject_sensitive_row_data` trigger
    // every control-plane table carries, so these two assert the refusal rather
    // than which of the two guards fired. The bounds below them are the part
    // only this migration's constraints enforce.
    it("refuses a credential-shaped instruction", async () => {
      await expect(
        assign(projectId, [
          {
            bot_id: bots.docsWriter,
            role_id: roles.developer,
            instructions: "Authenticate with sk-abcdefghijklmnopqrstuvwxyz012345",
          },
        ]),
      ).rejects.toThrow(/credential|sensitive|instructions_bounded/i);
    });

    it("refuses a credential-shaped responsibility", async () => {
      await expect(
        assign(projectId, [
          {
            bot_id: bots.docsWriter,
            role_id: roles.developer,
            responsibilities: ["ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
          },
        ]),
      ).rejects.toThrow(/credential|sensitive|responsibilities_safe/i);
    });

    it("refuses a responsibility list that is not strings", async () => {
      await expect(
        assign(projectId, [
          { bot_id: bots.docsWriter, role_id: roles.developer, responsibilities: [{ a: 1 }] },
        ]),
      ).rejects.toThrow(/bot_assignments_responsibilities_safe/);
    });

    it("refuses a blank responsibility rather than storing an empty line", async () => {
      await expect(
        assign(projectId, [
          { bot_id: bots.docsWriter, role_id: roles.developer, responsibilities: ["  "] },
        ]),
      ).rejects.toThrow(/bot_assignments_responsibilities_safe/);
    });

    it("refuses an instruction longer than the column allows", async () => {
      await expect(
        assign(projectId, [
          { bot_id: bots.docsWriter, role_id: roles.developer, instructions: "x".repeat(4001) },
        ]),
      ).rejects.toThrow(/bot_assignments_instructions_bounded/);
    });

    it("refuses more responsibilities than the column allows", async () => {
      await expect(
        assign(projectId, [
          {
            bot_id: bots.docsWriter,
            role_id: roles.developer,
            responsibilities: Array.from({ length: 13 }, (_, index) => `Duty ${index}`),
          },
        ]),
      ).rejects.toThrow(/bot_assignments_responsibilities_safe/);
    });

    it("refuses concurrency and priority outside their ladders", async () => {
      await expect(
        assign(projectId, [
          { bot_id: bots.docsWriter, role_id: roles.developer, max_concurrent_tasks: 50 },
        ]),
      ).rejects.toThrow(/bot_assignments_concurrency_bounded/);
      await expect(
        assign(projectId, [{ bot_id: bots.docsWriter, role_id: roles.developer, priority: 9 }]),
      ).rejects.toThrow(/bot_assignments_priority_bounded/);
    });

    it("refuses an unknown access vocabulary rather than silently downgrading", async () => {
      await expect(
        assign(projectId, [
          { bot_id: bots.docsWriter, role_id: roles.developer, repository_access: "admin" },
        ]),
      ).rejects.toThrow(/bot_assignments_repository_access_known/);
    });
  });

  describe("who may change an assignment", () => {
    it("refuses an ordinary member", async () => {
      await expect(
        assign(projectId, [{ bot_id: bots.docsWriter, role_id: roles.developer }], memberId),
      ).rejects.toThrow(/owner or admin/i);
    });

    it("refuses someone outside the organization", async () => {
      await expect(
        assign(projectId, [{ bot_id: bots.docsWriter, role_id: roles.developer }], outsiderId),
      ).rejects.toThrow();
    });

    it("refuses a member writing the table directly", async () => {
      await assumeRole(db, memberId);
      await expect(
        db.query(
          `update public.bot_assignments set repository_access = 'write'
           where project_id = $1::uuid`,
          [projectId],
        ),
      ).rejects.toThrow();
      await resetRole(db);
    });

    it("lets a member read the roster its console renders", async () => {
      await assumeRole(db, memberId);
      const readable = await db.query<{ id: string }>(
        "select id from public.bot_assignments where project_id = $1::uuid",
        [projectId],
      );
      await resetRole(db);
      expect(readable.rows.length).toBeGreaterThan(0);
    });
  });

  describe("managing a posting after it exists", () => {
    // Its own bot and its own posting, re-established before each case. Reading
    // whatever the previous cases left on a shared project made these depend on
    // execution order — and they silently stopped testing anything the moment
    // an earlier case moved that bot elsewhere.
    let managedAssignmentId: string;

    beforeEach(async () => {
      const [posting] = await assign(secondProjectId, [
        { bot_id: bots.managed, role_id: roles.developer, max_concurrent_tasks: 4 },
      ]);
      managedAssignmentId = posting.id;
    });

    async function reconfigure(
      assignmentId: string,
      configuration: Record<string, unknown>,
      status: string | null = null,
      actor: string = ownerId,
    ) {
      await assumeRole(db, actor);
      try {
        const result = await db.query<AssignmentRow>(
          `select * from public.update_bot_assignment_configuration(
             $1::uuid, $2::uuid, $3::jsonb, null, $4::public.bot_assignment_status
           )`,
          [organizationId, assignmentId, JSON.stringify(configuration), status],
        );
        return result.rows[0];
      } finally {
        await resetRole(db);
      }
    }

    it("pauses a bot and changes its permissions in one transition", async () => {
      const updated = await reconfigure(
        managedAssignmentId,
        { repository_access: "read", max_concurrent_tasks: 2 },
        "paused",
      );

      // One call, because a pause applied after a permission change leaves a
      // window where the wider grant is live and the pause is not.
      expect(updated.status).toBe("paused");
      expect(updated.repository_access).toBe("read");
      expect(updated.max_concurrent_tasks).toBe(2);
    });

    it("resumes a paused bot", async () => {
      await reconfigure(managedAssignmentId, {}, "paused");
      const updated = await reconfigure(managedAssignmentId, {}, "active");
      expect(updated.status).toBe("active");
    });

    it("releases a posting and refuses to reopen it", async () => {
      const released = await reconfigure(managedAssignmentId, {}, "released");
      expect(released.status).toBe("released");
      expect(released.released_at ?? null).not.toBeNull();

      await expect(reconfigure(managedAssignmentId, {}, "active")).rejects.toThrow(/released/i);
    });

    it("frees the bot for another project once released", async () => {
      await reconfigure(managedAssignmentId, {}, "released");

      // The one-open-posting index would otherwise make removal a dead end:
      // a released bot that cannot be re-assigned is retired, not removed.
      const rows = await assign(projectId, [
        { bot_id: bots.managed, role_id: roles.developer },
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].project_id).toBe(projectId);
    });

    it("refuses a member reconfiguring a posting", async () => {
      await expect(
        reconfigure(managedAssignmentId, {}, null, memberId),
      ).rejects.toThrow(/owner or admin/i);
    });

    it("refuses an assignment from another organization", async () => {
      // Read the id first: once the outsider's role is assumed, row-level
      // security hides the row entirely, so looking it up afterwards would
      // pass a null and prove nothing about the function's own check.
      await assumeRole(db, outsiderId);
      await expect(
        db.query(
          `select * from public.update_bot_assignment_configuration(
             $1::uuid, $2::uuid, '{}'::jsonb, null, null
           )`,
          [otherOrganizationId, managedAssignmentId],
        ),
      ).rejects.toThrow();
      await resetRole(db);
    });
  });
});
