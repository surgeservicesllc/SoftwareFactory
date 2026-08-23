// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONFIDENCE_BAND_VALUE } from "@/lib/graph/provider-bridge";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260823001100_node_run_confidence.sql";

const ownerId = "00000000-0000-4000-8000-0000000009c1";
const organizationId = "10000000-0000-4000-8000-0000000009c1";
const projectId = "20000000-0000-4000-8000-0000000009c1";
const graphId = "30000000-0000-4000-8000-0000000009c1";
const graphRunId = "40000000-0000-4000-8000-0000000009c1";
const nodeId = "50000000-0000-4000-8000-0000000009c1";
const nodeRunId = "60000000-0000-4000-8000-0000000009c1";
const workerId = "worker-confidence-1";

/**
 * The confidence a node reports, against the real migrated schema.
 *
 * The column and its projection both predate any writer, so the risk this
 * suite is guarding is not arithmetic. It is that the number in the column
 * stops meaning "what the executor reported" — by being defaulted when nothing
 * reported one, by being erased by a later transition on the same run, or by
 * being stored out of the range a reader assumes.
 */
describe("node run confidence", () => {
  let db: PGlite;

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

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrationFiles.at(-1)).toBe(latestMigration);
    for (const migrationFile of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Confidence Tenant', 'confidence-tenant', '${ownerId}');
      insert into public.projects (id, organization_id, name, created_by)
      values ('${projectId}', '${organizationId}', 'Confidence Project', '${ownerId}');
      insert into public.graphs (id, organization_id, project_id, goal, topology, created_by)
      values (
        '${graphId}', '${organizationId}', '${projectId}',
        'A run whose nodes report how sure they were.',
        'DIAMOND'::public.graph_topology, '${ownerId}'
      );
      insert into public.graph_nodes (
        id, organization_id, graph_id, node_key, job, executor, capability
      )
      values (
        '${nodeId}', '${organizationId}', '${graphId}', 'evaluate_fit',
        'Score each candidate.', 'MODEL'::public.graph_node_executor, 'review'
      );
      insert into public.graph_runs (id, organization_id, graph_id, state, created_by)
      values (
        '${graphRunId}', '${organizationId}', '${graphId}',
        'RUNNING'::public.graph_run_state, '${ownerId}'
      );
    `);
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  async function freshNodeRun(id: string): Promise<void> {
    await db.exec(`
      delete from public.node_runs where id = '${id}';
      insert into public.node_runs (id, organization_id, graph_run_id, node_id, state, attempt)
      values (
        '${id}', '${organizationId}', '${graphRunId}', '${nodeId}',
        'PENDING'::public.graph_node_state,
        (select coalesce(max(attempt), 0) + 1 from public.node_runs
          where graph_run_id = '${graphRunId}' and node_id = '${nodeId}')
      );
    `);
  }

  async function confidenceOf(id: string): Promise<number | null> {
    const read = await db.query<{ confidence: string | null }>(
      `select confidence from public.node_runs where id = '${id}'`,
    );
    const raw = read.rows[0]?.confidence ?? null;
    return raw === null ? null : Number(raw);
  }

  it("stores the band the executor reported", async () => {
    await freshNodeRun(nodeRunId);
    await db.exec(`
      select public.record_node_state_as_worker(
        '${workerId}', '${nodeRunId}', 'COMPLETED'::public.graph_node_state,
        null, 'anthropic', 'claude-opus-5', 1200, ${CONFIDENCE_BAND_VALUE.medium}
      );
    `);
    expect(await confidenceOf(nodeRunId)).toBe(CONFIDENCE_BAND_VALUE.medium);
  });

  it("leaves null when the executor reported none", async () => {
    // The honest state for every DETERMINISTIC and ANCHOR node. A file that was
    // read either was or was not, and a number here would be invented.
    const id = "60000000-0000-4000-8000-0000000009c2";
    await freshNodeRun(id);
    await db.exec(`
      select public.record_node_state_as_worker(
        '${workerId}', '${id}', 'COMPLETED'::public.graph_node_state,
        null, null, null, 40, null
      );
    `);
    expect(await confidenceOf(id)).toBeNull();
  });

  it("does not erase a reported confidence on a later transition", async () => {
    /*
     * The load-bearing case. A gated node reports its confidence on the
     * VERIFYING transition that carries its output, and the gate is answered
     * afterwards. If the update assigned rather than coalesced, answering the
     * gate would blank what the node reported — and the column would read null
     * for exactly the nodes a reader most wants it for.
     */
    const id = "60000000-0000-4000-8000-0000000009c3";
    await freshNodeRun(id);
    await db.exec(`
      select public.record_node_state_as_worker(
        '${workerId}', '${id}', 'VERIFYING'::public.graph_node_state,
        null, 'anthropic', 'claude-opus-5', 900, ${CONFIDENCE_BAND_VALUE.high}
      );
      select public.record_node_state_as_worker(
        '${workerId}', '${id}', 'COMPLETED'::public.graph_node_state,
        null, null, null, null, null
      );
    `);
    expect(await confidenceOf(id)).toBe(CONFIDENCE_BAND_VALUE.high);
  });

  it("refuses a value outside [0, 1] rather than clamping it", async () => {
    const id = "60000000-0000-4000-8000-0000000009c4";
    await freshNodeRun(id);
    await expect(
      db.exec(`
        select public.record_node_state_as_worker(
          '${workerId}', '${id}', 'COMPLETED'::public.graph_node_state,
          null, null, null, null, 1.4
        );
      `),
    ).rejects.toThrow(/confidence_out_of_range/);
    // And the node run is untouched, so a rejected write leaves no partial state.
    expect(await confidenceOf(id)).toBeNull();
  });

  it("exposes exactly one overload, so PostgREST cannot resolve the wrong one", async () => {
    /*
     * `create or replace` cannot change a signature, so adding the argument
     * without dropping first would leave the seven-argument function beside
     * the eight-argument one. A named-argument call naming seven of them would
     * then be ambiguous, and the worker would silently keep writing through the
     * overload that discards confidence.
     */
    const read = await db.query<{ count: string }>(`
      select count(*)::text as count
        from pg_proc routine
        join pg_namespace space on space.oid = routine.pronamespace
       where space.nspname = 'public'
         and routine.proname = 'record_node_state_as_worker'
    `);
    expect(Number(read.rows[0]?.count ?? 0)).toBe(1);
  });

  it("is executable by service_role and by nobody else", async () => {
    const read = await db.query<{
      service_role: boolean; authenticated: boolean; anon: boolean; definer: boolean;
    }>(`
      select has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_role,
             has_function_privilege('authenticated', routine.oid, 'EXECUTE') as authenticated,
             has_function_privilege('anon', routine.oid, 'EXECUTE') as anon,
             routine.prosecdef as definer
        from pg_proc routine
        join pg_namespace space on space.oid = routine.pronamespace
       where space.nspname = 'public'
         and routine.proname = 'record_node_state_as_worker'
    `);
    expect(read.rows[0]).toMatchObject({
      service_role: true, authenticated: false, anon: false, definer: true,
    });
  });

  it("still refuses an unrecognised worker", async () => {
    // The drop and recreate must not lose the identity assertion that was
    // there before it.
    const id = "60000000-0000-4000-8000-0000000009c5";
    await freshNodeRun(id);
    await expect(
      db.exec(`
        select public.record_node_state_as_worker(
          'not a valid worker id', '${id}', 'COMPLETED'::public.graph_node_state,
          null, null, null, null, ${CONFIDENCE_BAND_VALUE.low}
        );
      `),
    ).rejects.toThrow();
  });

  it("projects the confidence it stored", async () => {
    // Write-only data is its own kind of dead surface. `list_graph_runs` has
    // carried the column since the ten-stage widening; this proves the two
    // agree rather than assuming it.
    const id = "60000000-0000-4000-8000-0000000009c6";
    await freshNodeRun(id);
    await db.exec(`
      select public.record_node_state_as_worker(
        '${workerId}', '${id}', 'COMPLETED'::public.graph_node_state,
        null, 'anthropic', 'claude-opus-5', 700, ${CONFIDENCE_BAND_VALUE.low}
      );
    `);
    // `list_graph_runs` is the member-scoped reader and proves membership from
    // auth.uid(). Reading it with no claim set is a permission error rather
    // than an empty result, so the case has to stand where a member stands.
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
    const read = await db.query<{ nodes: unknown }>(`
      select nodes from public.list_graph_runs('${organizationId}'::uuid, 20)
       where graph_run_id = '${graphRunId}'::uuid
    `);
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    const nodes = read.rows[0]?.nodes as ReadonlyArray<Record<string, unknown>> | undefined;
    expect(nodes, "the run must project its nodes").toBeDefined();
    const projected = (nodes ?? []).find((node) => node.node_key === "evaluate_fit");
    expect(projected).toBeDefined();
    expect(Number(projected?.confidence)).toBe(CONFIDENCE_BAND_VALUE.low);
  });
});
