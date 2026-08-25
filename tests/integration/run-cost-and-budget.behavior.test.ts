// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * What a run spent, read back through `list_graph_runs`.
 *
 * The worker has written these four columns since 20260819000100 and no read
 * returned them. These cases pin the read, and the distinction the columns
 * carry: a run that reported no usage answers null, not zero.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");
/*
 * The chain's newest file, pinned as every integration suite here pins it: a
 * migration added after this was written should make somebody re-read this
 * case rather than let it pass unexamined.
 */
const latestMigration = "20260825000300_runs_state_their_closure_reason.sql";

const ownerId = "00000000-0000-4000-8000-00000000c001";
const organizationId = "10000000-0000-4000-8000-00000000c001";
const projectId = "40000000-0000-4000-8000-00000000c001";

let db: PGlite;

async function asOwner() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1::text, false)", [ownerId]);
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
    [ownerId],
  );
}

async function makeRun(overrides: Record<string, unknown>) {
  await db.exec("reset role");
  const graph = await db.query<{ id: string }>(
    `insert into public.graphs (organization_id, project_id, goal, topology, topology_reasons,
       risk_level, requires_owner_approval, created_by)
     values ($1::uuid, $2::uuid, 'Spend check', 'SEQUENTIAL'::public.graph_topology, '[]'::jsonb,
       'yellow'::public.risk_level, false, $3::uuid) returning id`,
    [organizationId, projectId, ownerId],
  );
  const columns = Object.keys(overrides);
  const values = Object.values(overrides);
  const names = ["organization_id", "graph_id", "created_by", "state", ...columns].join(", ");
  const placeholders = [
    "$1::uuid", "$2::uuid", "$3::uuid", "'COMPLETED'::public.graph_run_state",
    ...columns.map((_, index) => `$${index + 4}`),
  ].join(", ");
  const run = await db.query<{ id: string }>(
    `insert into public.graph_runs (${names}) values (${placeholders}) returning id`,
    [organizationId, graph.rows[0].id, ownerId, ...values],
  );
  return run.rows[0].id;
}

type Row = {
  graph_run_id: string;
  tokens_used: string | number | null;
  cost_micros: string | number | null;
  budget_action: string | null;
  discovery_rounds: number | null;
};

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
  const migrationFiles = (await readdir(migrationsRoot)).filter((n) => /^\d+.*\.sql$/.test(n)).sort();
  expect(migrationFiles.at(-1)).toBe(latestMigration);
  for (const file of migrationFiles) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}');
    insert into public.organizations (id, name, slug, created_by) values
      ('${organizationId}', 'Spend Co', 'spend-co', '${ownerId}');
    insert into public.projects (id, organization_id, name, status, created_by) values
      ('${projectId}', '${organizationId}', 'Spend Project', 'active', '${ownerId}');
    insert into public.organization_members (organization_id, user_id, role) values
      ('${organizationId}', '${ownerId}', 'owner')
    on conflict (organization_id, user_id) do update set role = excluded.role;
  `);
}, 180_000);

afterAll(async () => { await db?.close(); });

describe("list_graph_runs cost and budget", () => {
  it("returns what the worker recorded", async () => {
    const runId = await makeRun({
      tokens_used: 128_450,
      cost_micros: 2_407_311,
      budget_action: "PREFER_CHEAPER_MODEL",
      discovery_rounds: 3,
    });
    await asOwner();
    const listed = await db.query<Row>(
      `select graph_run_id, tokens_used, cost_micros, budget_action, discovery_rounds
         from public.list_graph_runs($1::uuid) where graph_run_id = $2::uuid`,
      [organizationId, runId],
    );
    expect(listed.rows).toHaveLength(1);
    const row = listed.rows[0];
    expect(Number(row.tokens_used)).toBe(128_450);
    expect(Number(row.cost_micros)).toBe(2_407_311);
    expect(row.budget_action).toBe("PREFER_CHEAPER_MODEL");
    expect(row.discovery_rounds).toBe(3);
  });

  it("answers null for a run that reported no usage, never zero", async () => {
    // A page rendering "$0.00" for an unmeasured run would be inventing a
    // measurement. Discovery rounds are not null by column definition, so
    // zero there really is zero.
    const runId = await makeRun({});
    await asOwner();
    const listed = await db.query<Row>(
      `select tokens_used, cost_micros, budget_action, discovery_rounds
         from public.list_graph_runs($1::uuid) where graph_run_id = $2::uuid`,
      [organizationId, runId],
    );
    expect(listed.rows[0].tokens_used).toBeNull();
    expect(listed.rows[0].cost_micros).toBeNull();
    expect(listed.rows[0].budget_action).toBeNull();
    expect(listed.rows[0].discovery_rounds).toBe(0);
  });

  it("keeps refusing a non-member", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1::text, false)", [
      "00000000-0000-4000-8000-00000000c009",
    ]);
    await expect(
      db.query("select graph_run_id from public.list_graph_runs($1::uuid)", [organizationId]),
    ).rejects.toThrow(/organization membership is required/);
  });
});
