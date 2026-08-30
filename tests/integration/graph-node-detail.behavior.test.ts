// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { describeNode, type DetailedNode } from "@/lib/graph/node-detail";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830000400_specialist_capability_stage_map.sql";

const ownerId = "00000000-0000-4000-8000-00000000ad01";
const organizationId = "10000000-0000-4000-8000-00000000ad01";
const projectId = "20000000-0000-4000-8000-00000000ad01";
const graphId = "30000000-0000-4000-8000-00000000ad01";
const runId = "40000000-0000-4000-8000-00000000ad01";

/**
 * What `list_graph_runs` tells a reader about one node.
 *
 * The panel could say a node FAILED and nothing else — not what it had been
 * asked to do, how long it ran, what it waited for, or what it produced. Every
 * column needed was already stored; only the read was missing.
 *
 * This exercises the real migration chain against real PostgreSQL, because the
 * defect class it guards is one no unit test can reach: a projection that
 * type-checks, lints and passes every mock while selecting a column that does
 * not exist, or joining artifacts on the wrong key so every node reports the
 * whole run's output as its own.
 */
describe("the node explains itself", () => {
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

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);

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
      values ('${organizationId}', 'Detail Tenant', 'detail-tenant', '${ownerId}');
      insert into public.projects (id, organization_id, name, created_by)
      values ('${projectId}', '${organizationId}', 'Detail Project', '${ownerId}');
      insert into public.graphs (id, organization_id, project_id, goal, topology, created_by)
      values (
        '${graphId}', '${organizationId}', '${projectId}',
        'Ship the change the architecture named.',
        'DIAMOND'::public.graph_topology, '${ownerId}'
      );
      insert into public.graph_runs (id, organization_id, graph_id, state, started_at, created_by)
      values ('${runId}', '${organizationId}', '${graphId}', 'RUNNING', now(), '${ownerId}');
    `);

    // Two nodes and a real edge between them, so the dependency projection has
    // a direction to get wrong.
    await db.exec(`
      insert into public.graph_nodes
        (id, organization_id, graph_id, node_key, job, executor, capability, lifecycle_stage, max_attempts)
      values
        ('50000000-0000-4000-8000-00000000ad01', '${organizationId}', '${graphId}',
         'architecture', 'Design the change.', 'MODEL'::public.graph_node_executor,
         'architecture', 'ARCHITECTURE'::public.sdlc_stage, 2),
        ('50000000-0000-4000-8000-00000000ad02', '${organizationId}', '${graphId}',
         'implement', 'Apply the change the architecture named.', 'MODEL'::public.graph_node_executor,
         'implementation', 'IMPLEMENTATION'::public.sdlc_stage, 3);

      insert into public.graph_edges
        (organization_id, graph_id, from_node_id, to_node_id, reason, detail)
      values
        ('${organizationId}', '${graphId}',
         '50000000-0000-4000-8000-00000000ad01', '50000000-0000-4000-8000-00000000ad02',
         'DATA'::public.graph_edge_reason,
         'The implementation needs the design.');

      insert into public.node_runs
        (id, organization_id, graph_run_id, node_id, state, queued_at, started_at, completed_at)
      values
        ('60000000-0000-4000-8000-00000000ad01', '${organizationId}', '${runId}',
         '50000000-0000-4000-8000-00000000ad01', 'COMPLETED',
         '2026-08-23T10:00:00Z', '2026-08-23T10:00:05Z', '2026-08-23T10:01:35Z'),
        ('60000000-0000-4000-8000-00000000ad02', '${organizationId}', '${runId}',
         '50000000-0000-4000-8000-00000000ad02', 'BLOCKED',
         '2026-08-23T10:00:00Z', null, null);

      update public.node_runs
         set blocked_reason = 'Waiting on the architecture gate.'
       where id = '60000000-0000-4000-8000-00000000ad02';

      -- One artifact, attributed to the architecture node only. If the
      -- projection joined on graph_run_id the implement node would claim it too.
      insert into public.graph_artifacts
        (organization_id, graph_run_id, node_run_id, kind, payload)
      values
        ('${organizationId}', '${runId}', '60000000-0000-4000-8000-00000000ad01',
         'SYNTHESIS'::public.graph_artifact_kind, '{"design":"recorded"}'::jsonb);
    `);
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  async function readNodes(): Promise<Map<string, DetailedNode>> {
    const { rows } = await db.query<{ nodes: DetailedNode[] }>(
      `select nodes from public.list_graph_runs($1::uuid, 20)`,
      [organizationId],
    );
    const nodes = rows[0]?.nodes ?? [];
    return new Map(nodes.map((node) => [node.node_key, node]));
  }

  it("tells the reader what the node was asked to do", async () => {
    const nodes = await readNodes();
    expect(nodes.get("implement")?.job).toBe("Apply the change the architecture named.");
    expect(nodes.get("architecture")?.job).toBe("Design the change.");
  });

  it("projects the node's own clocks, so a duration can be measured rather than guessed", async () => {
    const architecture = nodes(await readNodes(), "architecture");
    expect(architecture.queued_at).not.toBeNull();
    expect(architecture.node_started_at).not.toBeNull();
    expect(architecture.node_completed_at).not.toBeNull();
    expect(describeNode(architecture).elapsed).toBe("1m 30s");
  });

  it("leaves a node that never started without a duration", async () => {
    const implement = nodes(await readNodes(), "implement");
    expect(implement.node_started_at).toBeNull();
    expect(describeNode(implement).elapsed).toBeNull();
  });

  it("names what the node is waiting on, in its own row", async () => {
    const implement = nodes(await readNodes(), "implement");
    expect(implement.blocked_reason).toBe("Waiting on the architecture gate.");
  });

  it("points the dependency upstream, not downstream", async () => {
    // The edge runs architecture -> implement. The reader of `implement` wants
    // "architecture"; a reversed join would give architecture a dependency on
    // the node that consumes it, which reads just as plausible.
    const read = await readNodes();
    expect(nodes(read, "implement").depends_on).toEqual(["architecture"]);
    expect(nodes(read, "architecture").depends_on).toEqual([]);
  });

  it("attributes an artifact to the node that produced it, not to every node in the run", async () => {
    const read = await readNodes();
    expect(nodes(read, "architecture").artifact_counts).toEqual({ SYNTHESIS: 1 });
    expect(nodes(read, "implement").artifact_counts).toEqual({});
  });

  it("still reports the run-level artifact total, which counts the same row once", async () => {
    const { rows } = await db.query<{ artifact_counts: Record<string, number> }>(
      `select artifact_counts from public.list_graph_runs($1::uuid, 20)`,
      [organizationId],
    );
    expect(rows[0]?.artifact_counts).toEqual({ SYNTHESIS: 1 });
  });

  it("carries the node's configured attempt ceiling", async () => {
    const read = await readNodes();
    expect(nodes(read, "architecture").max_attempts).toBe(2);
    expect(nodes(read, "implement").max_attempts).toBe(3);
  });

  it("projects a measured attempt as itself and an unmeasured default as null", async () => {
    // `node_runs.attempt` has a writer since 20260830000100, and since
    // 20260830000300 the projection carries it — honestly: this fixture's
    // rows keep their insert default of 0, which is not a measurement, so
    // they project as null rather than a 0 that reads like data.
    const before = await readNodes();
    expect(nodes(before, "architecture")).toHaveProperty("attempt");
    expect(nodes(before, "architecture").attempt).toBeNull();

    // A row the writer actually measured projects its real count.
    await db.query(
      "update public.node_runs set attempt = 2 where id = '60000000-0000-4000-8000-00000000ad01'",
    );
    const after = await readNodes();
    expect(nodes(after, "architecture").attempt).toBe(2);
    await db.query(
      "update public.node_runs set attempt = 0 where id = '60000000-0000-4000-8000-00000000ad01'",
    );
  });

  it("keeps every field the panel already relied on", async () => {
    // The projection was widened, not rewritten. A key silently dropped here
    // would blank a column that has worked since round 5.
    const architecture = nodes(await readNodes(), "architecture");
    for (const key of ["node_key", "executor", "capability", "state", "lifecycle_stage"]) {
      expect(architecture).toHaveProperty(key);
    }
  });
});

function nodes(read: Map<string, DetailedNode>, key: string): DetailedNode {
  const node = read.get(key);
  if (!node) throw new Error(`No node ${key} in the projection.`);
  return node;
}
