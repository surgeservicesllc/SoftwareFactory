// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");

const graphTables = [
  "graph_templates",
  "graphs",
  "graph_budgets",
  "graph_nodes",
  "node_contracts",
  "graph_edges",
  "graph_runs",
  "node_runs",
  "graph_artifacts",
  "graph_handoffs",
  "graph_verifications",
  "work_locks",
  "graph_events",
] as const;

const ownerOneId = "00000000-0000-4000-8000-000000000101";
const ownerTwoId = "00000000-0000-4000-8000-000000000201";
const organizationOneId = "10000000-0000-4000-8000-000000000001";
const organizationTwoId = "10000000-0000-4000-8000-000000000002";
const projectOneId = "40000000-0000-4000-8000-000000000001";
const projectTwoId = "40000000-0000-4000-8000-000000000002";

type ApplicationRole = "anon" | "authenticated" | "service_role";

async function source(path: string) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

async function assumeRole(db: PGlite, role: ApplicationRole, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("Phase 2B graph engineering schema", () => {
  let db: PGlite;
  let graphOneId: string;
  let graphRunOneId: string;

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

    const migrationFiles = (await readdir(migrationsRoot))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    for (const migrationFile of migrationFiles) {
      await db.exec(await source(`supabase/migrations/${migrationFile}`));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerOneId}'), ('${ownerTwoId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationOneId}', 'Graph Factory One', 'graph-factory-one', '${ownerOneId}'),
        ('${organizationTwoId}', 'Graph Factory Two', 'graph-factory-two', '${ownerTwoId}');

      insert into public.projects (id, organization_id, name, status, created_by) values
        ('${projectOneId}', '${organizationOneId}', 'Tenant One Project', 'active', '${ownerOneId}'),
        ('${projectTwoId}', '${organizationTwoId}', 'Tenant Two Project', 'active', '${ownerTwoId}');
    `);

    const graph = await db.query<{ id: string }>(
      `insert into public.graphs (organization_id, project_id, goal, topology, created_by)
       values ($1, $2, 'Audit every route for missing authentication', 'DIAMOND', $3)
       returning id`,
      [organizationOneId, projectOneId, ownerOneId],
    );
    graphOneId = graph.rows[0].id;

    const run = await db.query<{ id: string }>(
      `insert into public.graph_runs (organization_id, graph_id, created_by)
       values ($1, $2, $3) returning id`,
      [organizationOneId, graphOneId, ownerOneId],
    );
    graphRunOneId = run.rows[0].id;
  }, 180_000);

  afterAll(async () => {
    await db?.close();
  });

  it("keeps row security and force row security on all thirteen tables", async () => {
    await resetRole(db);
    const result = await db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1)`,
      [graphTables as unknown as string[]],
    );

    expect(result.rows).toHaveLength(graphTables.length);
    for (const row of result.rows) {
      expect(row.relrowsecurity, `${row.relname} row security`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} force row security`).toBe(true);
    }
  });

  it("grants no write privilege on any graph table to the browser roles", async () => {
    await resetRole(db);
    const result = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon', 'authenticated')
          and table_name = any($1)
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`,
      [graphTables as unknown as string[]],
    );

    // Every write goes through a SECURITY DEFINER function, so a compromised
    // session cannot fabricate a verdict or release another run's lock.
    expect(result.rows).toEqual([]);
  });

  it("lets a member read their own organization's graph and hides another tenant's", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const mine = await db.query("select id from public.graphs");
    expect(mine.rows).toHaveLength(1);

    await assumeRole(db, "authenticated", ownerTwoId);
    const theirs = await db.query("select id from public.graphs");
    expect(theirs.rows).toHaveLength(0);
  });

  it("denies an anonymous caller outright rather than returning an empty set", async () => {
    // Stronger than an RLS filter: anon holds no SELECT privilege at all, so
    // the table is not merely empty for them, it is unreachable.
    await assumeRole(db, "anon");
    for (const table of graphTables) {
      await expect(
        db.query(`select * from public.${table}`),
        `${table} was reachable by anon`,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("refuses an edge that points at itself", async () => {
    await resetRole(db);
    const node = await db.query<{ id: string }>(
      `insert into public.graph_nodes (organization_id, graph_id, node_key, job, executor, capability)
       values ($1, $2, 'solo', 'a job', 'MODEL', 'extraction') returning id`,
      [organizationOneId, graphOneId],
    );

    await expect(
      db.query(
        `insert into public.graph_edges (organization_id, graph_id, from_node_id, to_node_id, reason, detail)
         values ($1, $2, $3, $3, 'DATA', 'self loop')`,
        [organizationOneId, graphOneId, node.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it("requires every edge to record why it exists", async () => {
    await resetRole(db);
    const a = await db.query<{ id: string }>(
      `insert into public.graph_nodes (organization_id, graph_id, node_key, job, executor, capability)
       values ($1, $2, 'a', 'a job', 'MODEL', 'extraction') returning id`,
      [organizationOneId, graphOneId],
    );
    const b = await db.query<{ id: string }>(
      `insert into public.graph_nodes (organization_id, graph_id, node_key, job, executor, capability)
       values ($1, $2, 'b', 'b job', 'MODEL', 'extraction') returning id`,
      [organizationOneId, graphOneId],
    );

    // An edge that cannot say why it exists is a fake edge.
    await expect(
      db.query(
        `insert into public.graph_edges (organization_id, graph_id, from_node_id, to_node_id, reason, detail)
         values ($1, $2, $3, $4, 'DATA', '   ')`,
        [organizationOneId, graphOneId, a.rows[0].id, b.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  describe("work locks", () => {
    const lockArgs = (resourceId: string) => [
      organizationOneId,
      projectOneId,
      "file",
      resourceId,
      graphRunOneId,
      null,
      300,
    ];

    async function acquire(resourceId: string) {
      return db.query<{ id: string; state: string }>(
        `select id, state from public.acquire_work_lock(
           $1::uuid, $2::uuid, $3::public.graph_resource_kind, $4::text, $5::uuid, $6::uuid, $7::integer)`,
        lockArgs(resourceId),
      );
    }

    it("lets one holder take a resource and refuses a second", async () => {
      await assumeRole(db, "authenticated", ownerOneId);
      const first = await acquire("app/page.tsx");
      expect(first.rows[0].state).toBe("HELD");

      // The database enforces this, not the scheduler remembering to check.
      await expect(acquire("app/page.tsx")).rejects.toThrow(/resource_locked/);
    });

    it("frees the resource once released", async () => {
      await assumeRole(db, "authenticated", ownerOneId);
      const held = await acquire("lib/released.ts");
      await db.query("select id from public.release_work_lock($1::uuid)", [held.rows[0].id]);

      const again = await acquire("lib/released.ts");
      expect(again.rows[0].state).toBe("HELD");
    });

    it("reclaims a lock whose holder died rather than wedging the project", async () => {
      await assumeRole(db, "authenticated", ownerOneId);
      const abandoned = await acquire("lib/abandoned.ts");

      // Simulate a crashed worker: the lease lapses and no one released it.
      await resetRole(db);
      await db.query(
        `update public.work_locks
            set acquired_at = now() - interval '10 minutes',
                heartbeat_at = now() - interval '10 minutes',
                expires_at = now() - interval '1 minute'
          where id = $1`,
        [abandoned.rows[0].id],
      );

      await assumeRole(db, "authenticated", ownerOneId);
      const reclaimed = await acquire("lib/abandoned.ts");
      expect(reclaimed.rows[0].state).toBe("HELD");

      await resetRole(db);
      const previous = await db.query<{ state: string }>(
        "select state from public.work_locks where id = $1",
        [abandoned.rows[0].id],
      );
      expect(previous.rows[0].state).toBe("EXPIRED");
    });

    it("extends a lease on heartbeat", async () => {
      await assumeRole(db, "authenticated", ownerOneId);
      const held = await acquire("lib/heartbeat.ts");

      await resetRole(db);
      const before = await db.query<{ expires_at: string }>(
        "select expires_at from public.work_locks where id = $1",
        [held.rows[0].id],
      );

      await assumeRole(db, "authenticated", ownerOneId);
      await db.query("select id from public.heartbeat_work_lock($1::uuid, $2::integer)", [
        held.rows[0].id,
        600,
      ]);

      await resetRole(db);
      const after = await db.query<{ expires_at: string }>(
        "select expires_at from public.work_locks where id = $1",
        [held.rows[0].id],
      );
      expect(Date.parse(after.rows[0].expires_at)).toBeGreaterThan(
        Date.parse(before.rows[0].expires_at),
      );
    });

    it("refuses to lock a resource for an organization the caller is not in", async () => {
      await assumeRole(db, "authenticated", ownerTwoId);
      await expect(
        db.query(
          `select id from public.acquire_work_lock(
             $1::uuid, $2::uuid, $3::public.graph_resource_kind, $4::text, $5::uuid, $6::uuid, $7::integer)`,
          lockArgs("cross/tenant.ts"),
        ),
      ).rejects.toThrow(/not_a_member/);
    });

    it("sweeps abandoned locks and reports how many it retired", async () => {
      await assumeRole(db, "authenticated", ownerOneId);
      const stale = await acquire("lib/swept.ts");

      await resetRole(db);
      await db.query(
        `update public.work_locks
            set acquired_at = now() - interval '10 minutes',
                expires_at = now() - interval '1 minute'
          where id = $1`,
        [stale.rows[0].id],
      );

      await assumeRole(db, "authenticated", ownerOneId);
      const swept = await db.query<{ expire_abandoned_work_locks: number }>(
        "select public.expire_abandoned_work_locks($1::uuid)",
        [organizationOneId],
      );
      expect(Number(swept.rows[0].expire_abandoned_work_locks)).toBeGreaterThanOrEqual(1);
    });
  });

  it("keeps a run's partial-input flag so it cannot present itself as whole", async () => {
    await resetRole(db);
    await db.query("update public.graph_runs set had_partial_input = true where id = $1", [
      graphRunOneId,
    ]);

    const result = await db.query<{ had_partial_input: boolean }>(
      "select had_partial_input from public.graph_runs where id = $1",
      [graphRunOneId],
    );
    expect(result.rows[0].had_partial_input).toBe(true);
  });

  it("rejects a budget that exceeds its own sanity bounds", async () => {
    await resetRole(db);
    await expect(
      db.query(
        `insert into public.graph_budgets (organization_id, graph_id, max_concurrent_nodes)
         values ($1, $2, 9999)`,
        [organizationOneId, graphOneId],
      ),
    ).rejects.toThrow();
  });
});
