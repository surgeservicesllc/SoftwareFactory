// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ANCHOR_KINDS, ANCHORED_CLAIMS, CLAIM_ACCEPTABLE_ANCHORS } from "@/lib/graph/anchors";

/**
 * Anchor persistence, against the real migrated schema.
 *
 * The behaviour worth proving is not that rows can be written — it is that the
 * database refuses to let a caller declare its own claim anchored. Every test
 * below offers evidence and checks what the database concludes, rather than
 * checking that what the caller said was stored.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000a001";
const outsiderId = "00000000-0000-4000-8000-00000000a002";
const organizationId = "10000000-0000-4000-8000-00000000a001";
const otherOrganizationId = "10000000-0000-4000-8000-00000000a002";
const projectId = "40000000-0000-4000-8000-00000000a001";
const workerId = "graph-worker-anchor-persistence";
const claimRepository = "factory/anchor-persistence";
const claimRequiredChecks = ["CI"];

async function assumeRole(db: PGlite, role: string, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function claimGraph(
  db: PGlite,
  graphId: string,
): Promise<{ graph_id: string; graph_run_id: string }> {
  await assumeRole(db, "service_role");
  const result = await db.query<{
    claim: { graph_id: string; graph_run_id: string } | null;
  }>(
    `select public.claim_planned_graph_v3($1, $2::text[], $3, $4::jsonb, 3) as claim`,
    [workerId, ["MODEL", "DETERMINISTIC", "ANCHOR"], claimRepository,
      JSON.stringify(claimRequiredChecks)],
  );
  await resetRole(db);
  expect(result.rows[0].claim, `worker queue did not offer graph ${graphId}`).not.toBeNull();
  expect(result.rows[0].claim!.graph_id).toBe(graphId);
  return result.rows[0].claim!;
}

const planNodes = [
  {
    node_key: "build",
    job: "Build the thing",
    executor: "MODEL",
    capability: "implementation",
    model_tier: "STANDARD",
    input_schema: {},
    output_schema: { type: "object" },
    reads: [],
    writes: [],
  },
];

async function createGraph(db: PGlite, organization = organizationId) {
  const result = await db.query<{ create_graph_from_plan: string }>(
    `select public.create_graph_from_plan(
       $1::uuid, $2::uuid, $3::text, $4::public.graph_topology, $5::jsonb,
       $6::public.risk_level, $7::boolean, $8::jsonb, $9::jsonb, $10::jsonb)`,
    [
      organization,
      projectId,
      "Anchor demonstration",
      "SINGLE_AGENT",
      JSON.stringify([{ code: "SINGLE_NODE", detail: "One node needs no scheduler" }]),
      "green",
      false,
      JSON.stringify(planNodes),
      JSON.stringify([]),
      JSON.stringify({ max_nodes: 20, max_concurrent_nodes: 4 }),
    ],
  );
  return result.rows[0].create_graph_from_plan;
}

describe("anchor persistence", () => {
  let db: PGlite;
  let graphRunId: string;
  let nodeRunId: string;

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
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Anchor Factory', 'anchor-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other', 'other-anchor', '${outsiderId}');

      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch, created_by
      ) values (
        '${projectId}', '${organizationId}', 'Anchored', 'active',
        '${claimRepository}', 'main', '${ownerId}'
      );
      insert into public.connections (
        id, organization_id, name, provider, status, secret_reference, created_by
      ) values (
        '30000000-0000-4000-8000-00000000a001', '${organizationId}',
        'GitHub', 'github', 'connected', 'env://GITHUB_APP', '${ownerId}'
      );
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values (
        '50000000-0000-4000-8000-00000000a001', '${organizationId}',
        '30000000-0000-4000-8000-00000000a001', 950001, 950002,
        'anchor-app', 950003, 'factory', 'Organization', 'Organization',
        'selected', 'active', now(), '${ownerId}'
      );
      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id,
        owner_login, name, full_name, default_branch, html_url, private,
        visibility, selected, github_updated_at
      ) values (
        '60000000-0000-4000-8000-00000000a001', '${organizationId}',
        '50000000-0000-4000-8000-00000000a001', 950004,
        'factory', 'anchor-persistence', '${claimRepository}', 'main',
        'https://github.com/${claimRepository}', true, 'private', true, now()
      );
      insert into public.project_connections (
        organization_id, project_id, connection_id, github_repository_id,
        is_primary, created_by
      ) values (
        '${organizationId}', '${projectId}',
        '30000000-0000-4000-8000-00000000a001',
        '60000000-0000-4000-8000-00000000a001', true, '${ownerId}'
      );
    `);

    // Planning remains a member action. Execution starts only when the
    // service-role worker atomically claims that plan and creates its run map.
    await assumeRole(db, "authenticated", ownerId);

    const graphId = await createGraph(db);
    const claimed = await claimGraph(db, graphId);
    graphRunId = claimed.graph_run_id;

    await resetRole(db);
    const { rows: nodeRunRows } = await db.query<{ id: string }>(
      "select id from public.node_runs where graph_run_id = $1 order by id limit 1",
      [graphRunId],
    );
    nodeRunId = nodeRunRows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("keeps the acceptable-anchor mapping identical to the one in source", async () => {
    // The mapping is duplicated in SQL on purpose — it is a security boundary
    // and a caller must not be able to declare what counts as evidence. The
    // cost of duplication is drift, and this is what pays it.
    const { rows } = await db.query<{ claim: string; kind: string }>(
      `select claim::text as claim, kind::text as kind
         from public.claim_acceptable_anchors order by claim, kind`,
    );

    const fromDatabase = new Map<string, string[]>();
    for (const row of rows) {
      fromDatabase.set(row.claim, [...(fromDatabase.get(row.claim) ?? []), row.kind]);
    }

    for (const claim of ANCHORED_CLAIMS) {
      expect(
        [...(fromDatabase.get(claim) ?? [])].sort(),
        `${claim} mapping drifted between SQL and lib/graph/anchors.ts`,
      ).toEqual([...CLAIM_ACCEPTABLE_ANCHORS[claim]].sort());
    }
    expect(fromDatabase.size).toBe(ANCHORED_CLAIMS.length);
  });

  it("declares the same anchor kinds as source", async () => {
    const { rows } = await db.query<{ label: string }>(
      `select e.enumlabel as label from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'anchor_kind' order by e.enumsortorder`,
    );
    expect(rows.map((row) => row.label)).toEqual([...ANCHOR_KINDS]);
  });

  it("keeps every anchor table under RLS with FORCE RLS and no browser writes", async () => {
    const { rows } = await db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and c.relname in ('graph_anchors', 'node_run_claims', 'claim_anchors', 'claim_acceptable_anchors')
        order by c.relname`,
    );

    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => !row.relrowsecurity || !row.relforcerowsecurity)).toEqual([]);

    const { rows: grants } = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where grantee in ('anon', 'authenticated') and table_schema = 'public'
          and table_name in ('graph_anchors', 'node_run_claims', 'claim_anchors')
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE')`,
    );
    // Every write goes through the SECURITY DEFINER boundary.
    expect(grants).toEqual([]);
  });

  it("records an observation without judging what it supports", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{ record_anchor: string }>(
      `select public.record_anchor(
         $1::uuid, 'test_run'::public.anchor_kind, 'vitest in node:22',
         now() - interval '1 minute', 'Suite passed', true, null, $2::uuid
       )`,
      [graphRunId, nodeRunId],
    );

    expect(rows[0].record_anchor).toMatch(/^[0-9a-f-]{36}$/);
    await resetRole(db);
  });

  it("refuses an observation dated in the future", async () => {
    await assumeRole(db, "authenticated", ownerId);
    await expect(
      db.query(
        `select public.record_anchor(
           $1::uuid, 'ci_check'::public.anchor_kind, 'CI',
           now() + interval '1 hour', 'Impossibly early', true, null, null
         )`,
        [graphRunId],
      ),
    ).rejects.toThrow(/graph_anchors_not_future/);
    await resetRole(db);
  });

  it("anchors a claim only when the evidence actually passed", async () => {
    await assumeRole(db, "authenticated", ownerId);

    const { rows: anchorRows } = await db.query<{ record_anchor: string }>(
      `select public.record_anchor(
         $1::uuid, 'ci_check'::public.anchor_kind, 'CI', now(), 'CI succeeded', true, 'https://x', $2::uuid
       )`,
      [graphRunId, nodeRunId],
    );

    const { rows } = await db.query<{ anchored: boolean; reason: string; claim_id: string }>(
      `select * from public.record_claim_anchoring(
         $1::uuid, 'TESTS_PASS'::public.anchored_claim, array[$2::uuid]
       )`,
      [nodeRunId, anchorRows[0].record_anchor],
    );

    expect(rows[0].anchored).toBe(true);
    expect(rows[0].reason).toContain("Supported by 1 observation");

    // The supporting evidence is linked, so the verdict can be audited rather
    // than taken on trust.
    const { rows: links } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.claim_anchors where claim_id = $1::uuid`,
      [rows[0].claim_id],
    );
    expect(links[0].count).toBe("1");
    await resetRole(db);
  });

  it("treats contradicting evidence as refutation, not support", async () => {
    await assumeRole(db, "authenticated", ownerId);

    const { rows: failing } = await db.query<{ record_anchor: string }>(
      `select public.record_anchor(
         $1::uuid, 'ci_check'::public.anchor_kind, 'CI', now(), 'CI failed', false, null, null
       )`,
      [graphRunId],
    );

    const { rows } = await db.query<{ anchored: boolean; reason: string; claim_id: string }>(
      `select * from public.record_claim_anchoring(
         $1::uuid, 'BUILD_SUCCEEDS'::public.anchored_claim, array[$2::uuid]
       )`,
      [nodeRunId, failing[0].record_anchor],
    );

    expect(rows[0].anchored).toBe(false);
    expect(rows[0].reason).toContain("contradicts the claim");

    // A contradicting anchor must not be linked as if it helped.
    const { rows: links } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.claim_anchors where claim_id = $1::uuid`,
      [rows[0].claim_id],
    );
    expect(links[0].count).toBe("0");
    await resetRole(db);
  });

  it("refuses evidence of the wrong kind for the claim", async () => {
    await assumeRole(db, "authenticated", ownerId);

    const { rows: deployment } = await db.query<{ record_anchor: string }>(
      `select public.record_anchor(
         $1::uuid, 'deployment_state'::public.anchor_kind, 'vercel', now(), 'Deployed', true, null, null
       )`,
      [graphRunId],
    );

    // A green deployment says nothing about whether lint is clean.
    const { rows } = await db.query<{ anchored: boolean; reason: string }>(
      `select * from public.record_claim_anchoring(
         $1::uuid, 'LINT_CLEAN'::public.anchored_claim, array[$2::uuid]
       )`,
      [nodeRunId, deployment[0].record_anchor],
    );

    expect(rows[0].anchored).toBe(false);
    expect(rows[0].reason).toContain("assertion rather than an observation");
    await resetRole(db);
  });

  it("does not let a state-only observation support a success claim", async () => {
    await assumeRole(db, "authenticated", ownerId);

    const { rows: health } = await db.query<{ record_anchor: string }>(
      `select public.record_anchor(
         $1::uuid, 'http_health'::public.anchor_kind, 'probe', now(), 'Observed 503', null, null, null
       )`,
      [graphRunId],
    );

    const { rows } = await db.query<{ anchored: boolean; reason: string }>(
      `select * from public.record_claim_anchoring(
         $1::uuid, 'SERVICE_HEALTHY'::public.anchored_claim, array[$2::uuid]
       )`,
      [nodeRunId, health[0].record_anchor],
    );

    expect(rows[0].anchored).toBe(false);
    expect(rows[0].reason).toContain("reports state rather than success");
    await resetRole(db);
  });

  it("refuses a claim offered no evidence at all", async () => {
    await assumeRole(db, "authenticated", ownerId);

    const { rows } = await db.query<{ anchored: boolean; reason: string }>(
      `select * from public.record_claim_anchoring(
         $1::uuid, 'MIGRATION_APPLIED'::public.anchored_claim, '{}'::uuid[]
       )`,
      [nodeRunId],
    );

    // The whole point: silence is not a pass.
    expect(rows[0].anchored).toBe(false);
    expect(rows[0].reason).toContain("assertion rather than an observation");
    await resetRole(db);
  });

  it("ignores evidence borrowed from another run", async () => {
    await assumeRole(db, "authenticated", ownerId);

    // A second run, with its own passing CI anchor.
    const otherGraphId = await createGraph(db);
    const otherRun = await claimGraph(db, otherGraphId);
    await assumeRole(db, "authenticated", ownerId);
    const { rows: foreign } = await db.query<{ record_anchor: string }>(
      `select public.record_anchor(
         $1::uuid, 'ci_check'::public.anchor_kind, 'CI', now(), 'Green, but elsewhere', true, null, null
       )`,
      [otherRun.graph_run_id],
    );

    const { rows } = await db.query<{ anchored: boolean; reason: string }>(
      `select * from public.record_claim_anchoring(
         $1::uuid, 'TYPECHECK_CLEAN'::public.anchored_claim, array[$2::uuid]
       )`,
      [nodeRunId, foreign[0].record_anchor],
    );

    // Evidence about another run is not evidence about this one.
    expect(rows[0].anchored).toBe(false);
    await resetRole(db);
  });

  it("refuses a second verdict for the same claim on the same node run", async () => {
    await assumeRole(db, "authenticated", ownerId);

    await db.query(
      `select * from public.record_claim_anchoring(
         $1::uuid, 'NO_SECURITY_FINDINGS'::public.anchored_claim, '{}'::uuid[]
       )`,
      [nodeRunId],
    );

    // Otherwise a refused claim could be retried until something stuck.
    await expect(
      db.query(
        `select * from public.record_claim_anchoring(
           $1::uuid, 'NO_SECURITY_FINDINGS'::public.anchored_claim, '{}'::uuid[]
         )`,
        [nodeRunId],
      ),
    ).rejects.toThrow(/node_run_claims_unique/);
    await resetRole(db);
  });

  it("denies a caller outside the organization", async () => {
    await assumeRole(db, "authenticated", outsiderId);

    await expect(
      db.query(
        `select public.record_anchor(
           $1::uuid, 'ci_check'::public.anchor_kind, 'CI', now(), 'Not mine', true, null, null
         )`,
        [graphRunId],
      ),
    ).rejects.toThrow(/not_a_member/);

    await expect(
      db.query(
        `select * from public.record_claim_anchoring(
           $1::uuid, 'TESTS_PASS'::public.anchored_claim, '{}'::uuid[]
         )`,
        [nodeRunId],
      ),
    ).rejects.toThrow(/not_a_member/);
    await resetRole(db);
  });

  it("denies anonymous callers outright", async () => {
    await assumeRole(db, "anon");
    await expect(db.query(`select * from public.graph_anchors`)).rejects.toThrow(
      /permission denied/i,
    );
    await resetRole(db);
  });

  it("records how many observations backed a verification", async () => {
    // Zero is a legitimate and important value: a verifier that reasoned
    // without evidence is a fact worth being able to query.
    const { rows } = await db.query<{ column_default: string; is_nullable: string }>(
      `select column_default, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'graph_verifications'
          and column_name = 'anchor_count'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe("NO");
    expect(rows[0].column_default).toContain("0");
  });
});
