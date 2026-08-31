// @vitest-environment node

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GraphExecutionTarget } from "@/lib/worker/graph-target";
import { createMigratedDatabase } from "@/tests/support/migrated-database";

const ownerId = "01000000-0000-4000-8000-000000000021";
const organizationId = "02000000-0000-4000-8000-000000000021";
const projectId = "03000000-0000-4000-8000-000000000021";
const connectionId = "04000000-0000-4000-8000-000000000021";
const installationId = "05000000-0000-4000-8000-000000000021";
const repositoryId = "06000000-0000-4000-8000-000000000021";
const repositoryFullName = "factory/exact-graph-target";
const baseSha = "a".repeat(40);
const requiredChecks = ["CI"];

async function assumeRole(db: PGlite, role: "authenticated" | "service_role", userId = "") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("exact graph repository workspace database boundary", { timeout: 180_000 }, () => {
  let db: PGlite;
  let graphId: string;

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id, email) values ('${ownerId}', 'exact-target@example.test');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Exact Target', 'exact-target', '${ownerId}');
      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch, created_by
      ) values (
        '${projectId}', '${organizationId}', 'Exact Target', 'active',
        '${repositoryFullName}', 'main', '${ownerId}'
      );
      insert into public.connections (
        id, organization_id, name, provider, status, secret_reference, created_by
      ) values (
        '${connectionId}', '${organizationId}', 'GitHub', 'github', 'connected',
        'env://GITHUB_APP', '${ownerId}'
      );
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}', 920001, 920002,
        'exact-target-app', 920003, 'factory', 'Organization', 'Organization',
        'selected', 'active', now(), '${ownerId}'
      );
      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id,
        owner_login, name, full_name, default_branch, html_url, private,
        visibility, selected, github_updated_at
      ) values (
        '${repositoryId}', '${organizationId}', '${installationId}', 920004,
        'factory', 'exact-graph-target', '${repositoryFullName}', 'main',
        'https://github.com/${repositoryFullName}', true, 'private', true, now()
      );
      insert into public.project_connections (
        organization_id, project_id, connection_id, github_repository_id,
        is_primary, created_by
      ) values (
        '${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}',
        true, '${ownerId}'
      );
    `);

    await assumeRole(db, "authenticated", ownerId);
    const created = await db.query<{ graph_id: string }>(`
      select public.create_graph_from_plan(
        $1::uuid, $2::uuid, 'Inspect the exact target', 'DAG'::public.graph_topology,
        '[]'::jsonb, 'green'::public.risk_level, false,
        '[{"node_key":"inspect","job":"Inspect only","executor":"MODEL","capability":"discovery","max_attempts":1,"input_schema":{},"output_schema":{"type":"object"},"reads":[],"writes":[]}]'::jsonb,
        '[]'::jsonb, '{"max_nodes":1,"max_concurrent_nodes":1}'::jsonb
      ) as graph_id
    `, [organizationId, projectId]);
    graphId = created.rows[0]!.graph_id;
    await resetRole(db);

    // A direct postgres fixture establishes the same one-time fields that the
    // exact server launch records. The write-once trigger remains active.
    await db.query(`
      update public.graphs
         set github_repository_id = $2::uuid,
             base_branch = 'main',
             base_sha = $3,
             required_check_names = $4::jsonb,
             required_checks_sha256 = encode(sha256(convert_to($4::jsonb::text, 'UTF8')), 'hex')
       where id = $1::uuid
    `, [graphId, repositoryId, baseSha, JSON.stringify(requiredChecks)]);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("exposes one bounded current identity only to service_role", async () => {
    await assumeRole(db, "authenticated", ownerId);
    await expect(db.query(
      "select public.resolve_graph_execution_target_as_worker($1::uuid, 1)",
      [graphId],
    )).rejects.toThrow(/permission denied/i);

    await assumeRole(db, "service_role");
    const result = await db.query<{ target: GraphExecutionTarget }>(
      "select public.resolve_graph_execution_target_as_worker($1::uuid, 1) as target",
      [graphId],
    );
    expect(result.rows[0]!.target).toMatchObject({
      protocol_version: 1,
      graph_id: graphId,
      organization_id: organizationId,
      project_id: projectId,
      connection_id: connectionId,
      github_repository_id: repositoryId,
      internal_installation_id: installationId,
      external_installation_id: 920001,
      app_id: 920002,
      external_repository_id: 920004,
      repository_full_name: repositoryFullName,
      base_branch: "main",
      base_sha: baseSha,
      required_check_names: requiredChecks,
      target_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(Object.keys(result.rows[0]!.target).sort()).toEqual([
      "app_id", "base_branch", "base_sha", "connection_id", "external_installation_id",
      "external_repository_id", "github_repository_id", "graph_id", "internal_installation_id",
      "organization_id", "project_id", "protocol_version", "repository_full_name",
      "required_check_names", "required_checks_sha256", "target_sha256",
    ]);
    await resetRole(db);
  });

  it("refuses wrong repository, SHA, or installation before creating a run, then claims the exact target", async () => {
    await assumeRole(db, "service_role");
    const resolved = await db.query<{ target: GraphExecutionTarget }>(
      "select public.resolve_graph_execution_target_as_worker($1::uuid, 1) as target",
      [graphId],
    );
    const target = resolved.rows[0]!.target;
    for (const wrong of [
      { ...target, repository_full_name: "factory/wrong-repository" },
      { ...target, base_sha: "b".repeat(40) },
      { ...target, external_installation_id: 999999 },
    ]) {
      await expect(db.query(
        "select public.claim_planned_graph_by_target_v4($1, $2::text[], $3::jsonb, 4)",
        ["exact-worker", ["MODEL"], JSON.stringify(wrong)],
      )).rejects.toThrow(/target changed before claim/i);
    }
    await resetRole(db);
    const before = await db.query<{ runs: number }>(
      "select count(*)::integer as runs from public.graph_runs where graph_id=$1",
      [graphId],
    );
    expect(before.rows[0]!.runs).toBe(0);

    await assumeRole(db, "service_role");
    const claimed = await db.query<{ claim: Record<string, unknown> }>(
      "select public.claim_planned_graph_by_target_v4($1, $2::text[], $3::jsonb, 4) as claim",
      ["exact-worker", ["MODEL"], JSON.stringify(target)],
    );
    expect(claimed.rows[0]!.claim).toMatchObject({
      graph_id: graphId,
      project_repository: repositoryFullName,
      base_branch: "main",
      base_sha: baseSha,
      required_check_names: requiredChecks,
      required_checks_sha256: target.required_checks_sha256,
      repository_target_sha256: target.target_sha256,
    });
    await resetRole(db);
  });
});
