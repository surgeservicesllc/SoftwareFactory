// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");
const workflowPath = resolve(repositoryRoot, ".github/workflows/graph-artifact-containment.yml");
const fenceMigration = "20260827000150_fence_legacy_graph_protocol.sql";
const containmentMigration = "20260827000210_contain_legacy_graph_artifact_payloads.sql";
const lineageMigration = "20260827000200_graph_phase1c_release_lineage.sql";

const ownerId = "00000000-0000-4000-8000-000000000101";
const organizationId = "10000000-0000-4000-8000-000000000101";
const projectId = "20000000-0000-4000-8000-000000000101";
const graphId = "30000000-0000-4000-8000-000000000101";
const nodeId = "40000000-0000-4000-8000-000000000101";
const graphRunId = "50000000-0000-4000-8000-000000000101";
const nodeRunId = "60000000-0000-4000-8000-000000000101";
const sensitiveArtifactId = "70000000-0000-4000-8000-000000000101";
const oversizedArtifactId = "70000000-0000-4000-8000-000000000102";

async function migrationFiles(): Promise<string[]> {
  return (await readdir(migrationsRoot))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
}

async function createDatabase(): Promise<PGlite> {
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
  return db;
}

async function applyMigration(db: PGlite, name: string): Promise<void> {
  await db.exec(await readFile(resolve(migrationsRoot, name), "utf8"));
}

async function applyThroughFence(db: PGlite): Promise<void> {
  await applyThrough(db, fenceMigration);
}

async function applyThrough(db: PGlite, targetMigration: string): Promise<void> {
  const files = await migrationFiles();
  const targetIndex = files.indexOf(targetMigration);
  expect(targetIndex).toBeGreaterThanOrEqual(0);
  for (const file of files.slice(0, targetIndex + 1)) {
    await applyMigration(db, file);
  }
}

async function lineageAclPostflightSql(): Promise<string> {
  const source = await readFile(workflowPath, "utf8");
  const workflow = parse(source) as {
    jobs: {
      containment: {
        steps: Array<{ name: string; run?: string }>;
      };
    };
  };
  const run = workflow.jobs.containment.steps.find(
    (step) => step.name === "Install the unchanged graph Phase 1C lineage after containment",
  )?.run ?? "";
  const escaped = run.match(
    /-c "(do \\\$lineage_acl_postflight\\\$[\s\S]*?\\\$lineage_acl_postflight\\\$;)"/,
  )?.[1];
  expect(escaped).toBeDefined();
  return escaped!.replace(/\\\$/g, "$");
}

describe("legacy graph artifact payload containment behavior", { timeout: 240_000 }, () => {
  it("keeps the complete fresh migration chain executable in filename order", async () => {
    const db = await createDatabase();
    try {
      for (const file of await migrationFiles()) {
        await applyMigration(db, file);
      }

      const catalog = await db.query<{
        containment_rows: number;
        guards_validated: boolean;
        private_rls: boolean;
      }>(`
        select
          (select count(*)::integer from public.graph_artifact_payload_containments)
            as containment_rows,
          (select count(*) = 2 and bool_and(convalidated)
             from pg_catalog.pg_constraint
            where conrelid = 'public.graph_artifacts'::regclass
              and conname in (
                'graph_artifacts_payload_no_sensitive_data',
                'graph_artifacts_payload_size_bounded'
              )) as guards_validated,
          (select relrowsecurity and relforcerowsecurity
             from pg_catalog.pg_class
            where oid = 'public.graph_artifact_payload_containments'::regclass)
            as private_rls
      `);
      expect(catalog.rows[0]).toEqual({
        containment_rows: 0,
        guards_validated: true,
        private_rls: true,
      });
    } finally {
      await db.close();
    }
  });

  it.each([
    { ledger: false, lineage: false, label: "no ledger before lineage" },
    { ledger: true, lineage: false, label: "hosted ledger before lineage" },
    { ledger: false, lineage: true, label: "no ledger after lineage" },
    { ledger: true, lineage: true, label: "hosted ledger after lineage" },
  ])("refuses a regranted legacy mutator with $label", async ({ ledger, lineage }) => {
    const db = await createDatabase();
    try {
      await applyThrough(db, lineage ? lineageMigration : fenceMigration);
      if (ledger) {
        await db.exec(`
          create schema supabase_migrations;
          create table supabase_migrations.schema_migrations (
            version text primary key
          );
          insert into supabase_migrations.schema_migrations (version)
          values ('20260827000150')
          ${lineage ? ", ('20260827000200')" : ""};
        `);
      }
      await db.exec(
        "grant execute on function public.start_graph_run(uuid) to service_role",
      );

      await expect(applyMigration(db, containmentMigration)).rejects.toThrow(
        /legacy graph protocol authority fence is not committed/i,
      );
      const catalog = await db.query<{ absent: boolean }>(`
        select pg_catalog.to_regclass(
          'public.graph_artifact_payload_containments'
        ) is null as absent
      `);
      expect(catalog.rows[0].absent).toBe(true);
    } finally {
      await db.close();
    }
  });

  it("treats a future-skew active worker heartbeat as live and fails before DDL", async () => {
    const db = await createDatabase();
    try {
      await applyThroughFence(db);
      await db.exec(`
        insert into public.phase1c_workers (
          worker_id, version, status, last_heartbeat_at
        ) values (
          'future-skew-worker', 'fixture', 'active',
          pg_catalog.now() + interval '1 day'
        )
      `);

      await expect(applyMigration(db, containmentMigration)).rejects.toThrow(
        /requires the fully stopped safety state/i,
      );
      const before = await db.query<{ absent: boolean }>(`
        select pg_catalog.to_regclass(
          'public.graph_artifact_payload_containments'
        ) is null as absent
      `);
      expect(before.rows[0].absent).toBe(true);

      await db.exec(`
        update public.phase1c_workers
           set status = 'disabled'
         where worker_id = 'future-skew-worker'
      `);
      await applyMigration(db, containmentMigration);
      const after = await db.query<{ present: boolean }>(`
        select pg_catalog.to_regclass(
          'public.graph_artifact_payload_containments'
        ) is not null as present
      `);
      expect(after.rows[0].present).toBe(true);
    } finally {
      await db.close();
    }
  });

  it("executes the workflow lineage ACL postflight over the hosted-order catalog", async () => {
    const db = await createDatabase();
    try {
      await applyThroughFence(db);
      await applyMigration(db, containmentMigration);
      await applyMigration(db, lineageMigration);

      const postflight = await lineageAclPostflightSql();
      const workerBlock = postflight.match(
        /foreach signature in array array\[\s*'claim_planned_graph_v2[\s\S]*?\]\s*loop/,
      )?.[0] ?? "";
      const workerSignatures = [...workerBlock.matchAll(/'([^']+)'/g)]
        .map((match) => match[1]);
      expect(workerSignatures).toHaveLength(16);
      expect(new Set(workerSignatures).size).toBe(16);
      await expect(db.exec(postflight)).resolves.toHaveLength(1);

      // An inherited grant can make has_function_privilege() look correct while
      // leaving an unexpected raw ACL entry. The workflow must reject it.
      await db.exec(`
        create role inherited_worker_executor nologin;
        grant execute on function public.claim_planned_graph_v2(
          text, text[], text, jsonb, integer
        ) to inherited_worker_executor;
        grant inherited_worker_executor to service_role;
      `);
      await expect(db.exec(postflight)).rejects.toThrow(
        /worker lineage function ACL is not service-role-only/i,
      );
      await db.exec(`
        revoke inherited_worker_executor from service_role;
        revoke execute on function public.claim_planned_graph_v2(
          text, text[], text, jsonb, integer
        ) from inherited_worker_executor;
        drop role inherited_worker_executor;
      `);

      await db.exec(`
        grant execute on function public.claim_planned_graph_v2(
          text, text[], text, jsonb, integer
        ) to authenticated
      `);
      await expect(db.exec(postflight)).rejects.toThrow(
        /worker lineage function ACL is not service-role-only/i,
      );
    } finally {
      await db.close();
    }
  });

  it("tombstones legacy sensitive and oversized rows, preserves private digest evidence, then accepts lineage", async () => {
    const db = await createDatabase();
    try {
      await applyThroughFence(db);

      // Recreate the historical state that NOT VALID was designed for: rows
      // predate the guard, while all writes after the guard remain checked.
      await db.exec(`
        insert into auth.users (id) values ('${ownerId}');
        insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Containment Fixture', 'containment-fixture', '${ownerId}');
        insert into public.projects (
          id, organization_id, name, status, created_by
        ) values (
          '${projectId}', '${organizationId}', 'Containment Project', 'active', '${ownerId}'
        );
        insert into public.graphs (
          id, organization_id, project_id, goal, topology, created_by
        ) values (
          '${graphId}', '${organizationId}', '${projectId}',
          'Contain only the exact legacy payloads', 'SEQUENTIAL', '${ownerId}'
        );
        insert into public.graph_nodes (
          id, organization_id, graph_id, node_key, job, executor, capability
        ) values (
          '${nodeId}', '${organizationId}', '${graphId}', 'fixture',
          'Produce legacy evidence', 'ANCHOR', 'synthesis'
        );
        insert into public.graph_runs (
          id, organization_id, graph_id, state, created_by
        ) values (
          '${graphRunId}', '${organizationId}', '${graphId}', 'PARTIAL', '${ownerId}'
        );
        insert into public.node_runs (
          id, organization_id, graph_run_id, node_id, state, attempt
        ) values (
          '${nodeRunId}', '${organizationId}', '${graphRunId}', '${nodeId}', 'COMPLETED', 1
        );

        alter table public.graph_artifacts
          drop constraint graph_artifacts_payload_no_sensitive_data;
        insert into public.graph_artifacts (
          id, organization_id, graph_run_id, node_run_id, kind, payload
        ) values
          (
            '${sensitiveArtifactId}', '${organizationId}', '${graphRunId}',
            '${nodeRunId}', 'RAW',
            pg_catalog.jsonb_build_object('client' || 'Secret', 'fixture-redacted')
          ),
          (
            '${oversizedArtifactId}', '${organizationId}', '${graphRunId}',
            '${nodeRunId}', 'REDUCED',
            pg_catalog.jsonb_build_object('report', pg_catalog.repeat('x', 1048600))
          );
        alter table public.graph_artifacts
          add constraint graph_artifacts_payload_no_sensitive_data
          check (not public.jsonb_has_sensitive_keys(payload)) not valid;
      `);

      const originals = await db.query<{
        artifact_id: string;
        payload_sha256: string;
        payload_octets: number;
        sensitive: boolean;
        oversized: boolean;
      }>(`
        select id::text as artifact_id,
               pg_catalog.encode(
                 pg_catalog.sha256(pg_catalog.convert_to(payload::text, 'UTF8')),
                 'hex'
               ) as payload_sha256,
               pg_catalog.octet_length(payload::text)::integer as payload_octets,
               public.jsonb_has_sensitive_keys(payload) as sensitive,
               pg_catalog.octet_length(payload::text) > 1048576 as oversized
          from public.graph_artifacts
         order by id
      `);
      expect(originals.rows).toHaveLength(2);
      expect(originals.rows.map((row) => [row.artifact_id, row.sensitive, row.oversized])).toEqual([
        [sensitiveArtifactId, true, false],
        [oversizedArtifactId, false, true],
      ]);

      await applyMigration(db, containmentMigration);

      const contained = await db.query<{
        artifact_id: string;
        evidence_id: string;
        original_payload_sha256: string;
        original_payload_octets: number;
        payload_text: string;
        reason: string;
        sensitive_data_detected: boolean;
        size_limit_exceeded: boolean;
      }>(`
        select containment.artifact_id::text,
               containment.id::text as evidence_id,
               containment.original_payload_sha256,
               containment.original_payload_octets::integer,
               artifact.payload::text as payload_text,
               containment.reason,
               containment.sensitive_data_detected,
               containment.size_limit_exceeded
          from public.graph_artifact_payload_containments containment
          join public.graph_artifacts artifact on artifact.id = containment.artifact_id
         order by containment.artifact_id
      `);
      expect(contained.rows).toHaveLength(2);

      for (const row of contained.rows) {
        const original = originals.rows.find((candidate) => candidate.artifact_id === row.artifact_id);
        expect(original).toBeDefined();
        expect(row.original_payload_sha256).toBe(original!.payload_sha256);
        expect(row.original_payload_octets).toBe(original!.payload_octets);
        expect(row.reason).toBe("legacy_sensitive_or_oversized_graph_artifact");
        expect(row.sensitive_data_detected).toBe(original!.sensitive);
        expect(row.size_limit_exceeded).toBe(original!.oversized);
        expect(JSON.parse(row.payload_text)).toEqual({
          contained: true,
          containmentEvidenceId: row.evidence_id,
          reason: "legacy_artifact_policy_violation",
        });
      }

      const security = await db.query<{
        audit_columns: string[];
        audit_table_exact: boolean;
        no_foreign_keys: boolean;
        no_role_access: boolean;
        immutable_trigger_exact: boolean;
        immutable_function_exact: boolean;
        artifact_trigger: boolean;
        graph_mutation_acls_closed: boolean;
        guards_validated: boolean;
      }>(`
        select
          (select pg_catalog.array_agg(column_name order by ordinal_position)
             from information_schema.columns
            where table_schema = 'public'
              and table_name = 'graph_artifact_payload_containments') as audit_columns,
          (select pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
                  and relation.relrowsecurity
                  and relation.relforcerowsecurity
                  and not exists (
                    select 1
                      from pg_catalog.aclexplode(coalesce(
                        relation.relacl,
                        pg_catalog.acldefault('r', relation.relowner)
                      )) privilege
                     where privilege.grantee <> relation.relowner
                  )
             from pg_catalog.pg_class relation
            where relation.oid =
              'public.graph_artifact_payload_containments'::regclass)
            as audit_table_exact,
          not exists (
            select 1 from pg_catalog.pg_constraint
             where conrelid = 'public.graph_artifact_payload_containments'::regclass
               and contype = 'f'
          ) as no_foreign_keys,
          not pg_catalog.has_table_privilege(
            'anon', 'public.graph_artifact_payload_containments',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          ) and not pg_catalog.has_table_privilege(
            'authenticated', 'public.graph_artifact_payload_containments',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          ) and not pg_catalog.has_table_privilege(
            'service_role', 'public.graph_artifact_payload_containments',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          ) as no_role_access,
          (select count(*) = 1 from pg_catalog.pg_trigger
            where tgrelid = 'public.graph_artifact_payload_containments'::regclass
              and tgname = 'graph_artifact_payload_containments_immutable'
              and not tgisinternal
              and tgenabled = 'O'
              and tgtype = 58
              and tgfoid = pg_catalog.to_regprocedure(
                'public.enforce_graph_artifact_payload_containment_immutable()'
              )) as immutable_trigger_exact,
          (select pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
                  and language.lanname = 'plpgsql'
                  and routine.prokind = 'f'
                  and routine.provolatile = 'v'
                  and routine.prorettype = 'trigger'::regtype
                  and routine.prosecdef
                  and routine.proconfig = array['search_path=pg_catalog']::text[]
                  and pg_catalog.btrim(
                    pg_catalog.replace(
                      pg_catalog.replace(routine.prosrc, E'\r\n', E'\n'),
                      E'\r', E'\n'
                    ),
                    E' \n'
                  ) = E'begin\n  raise exception using errcode = ''55000'',\n    message = ''graph artifact payload containment evidence is immutable'';\nend;'
                  and routine.proacl is not null
                  and (select pg_catalog.count(*)
                         from pg_catalog.aclexplode(routine.proacl)) = 1
                  and exists (
                    select 1
                      from pg_catalog.aclexplode(routine.proacl) privilege
                     where privilege.grantor = routine.proowner
                       and privilege.grantee = routine.proowner
                       and privilege.privilege_type = 'EXECUTE'
                       and not privilege.is_grantable
                  )
             from pg_catalog.pg_proc routine
             join pg_catalog.pg_language language on language.oid = routine.prolang
            where routine.oid = pg_catalog.to_regprocedure(
              'public.enforce_graph_artifact_payload_containment_immutable()'
            )) as immutable_function_exact,
          (select count(*) = 1 from pg_catalog.pg_trigger
            where tgrelid = 'public.graph_artifacts'::regclass
              and tgname = 'graph_artifacts_update_immutable'
              and not tgisinternal and tgenabled = 'O') as artifact_trigger,
          not exists (
            select 1
              from (values
                ('anon'), ('authenticated'), ('service_role')
              ) as checked_role(role_name)
             cross join (values
                ('public.graph_artifacts'), ('public.graph_verifications')
              ) as checked_table(table_name)
             where pg_catalog.has_table_privilege(
               checked_role.role_name,
               checked_table.table_name,
               'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
             )
          ) as graph_mutation_acls_closed,
          (select count(*) = 2 and bool_and(convalidated)
             from pg_catalog.pg_constraint
            where conrelid = 'public.graph_artifacts'::regclass
              and conname in (
                'graph_artifacts_payload_no_sensitive_data',
                'graph_artifacts_payload_size_bounded'
              )) as guards_validated
      `);
      expect(security.rows[0].audit_columns).not.toContain("payload");
      expect(security.rows[0]).toMatchObject({
        audit_table_exact: true,
        no_foreign_keys: true,
        no_role_access: true,
        immutable_trigger_exact: true,
        immutable_function_exact: true,
        artifact_trigger: true,
        graph_mutation_acls_closed: true,
        guards_validated: true,
      });

      await expect(db.exec(
        "update public.graph_artifact_payload_containments set reason = reason",
      )).rejects.toThrow(/containment evidence is immutable/i);
      await expect(db.exec(
        "delete from public.graph_artifact_payload_containments",
      )).rejects.toThrow(/containment evidence is immutable/i);
      await expect(db.exec(
        "truncate table public.graph_artifact_payload_containments",
      )).rejects.toThrow(/containment evidence is immutable/i);
      await expect(db.exec(
        "update public.graph_artifacts set payload = payload",
      )).rejects.toThrow(/graph artifacts are immutable audit evidence/i);

      // The published lineage migration stays byte-for-byte unchanged. Once
      // containment has removed the blocked rows, it must apply cleanly and
      // preserve the two private audit records and exact tombstones.
      await applyMigration(db, lineageMigration);
      const lineage = await db.query<{
        audit_rows: number;
        owner_gate_exact: boolean;
        safe_artifacts: boolean;
        protocol_v2_installed: boolean;
      }>(`
        select
          (select count(*)::integer from public.graph_artifact_payload_containments)
            as audit_rows,
          not pg_catalog.has_function_privilege(
            'anon', 'public.decide_node_gate(uuid,boolean,text)', 'EXECUTE'
          ) and pg_catalog.has_function_privilege(
            'authenticated', 'public.decide_node_gate(uuid,boolean,text)', 'EXECUTE'
          ) and not pg_catalog.has_function_privilege(
            'service_role', 'public.decide_node_gate(uuid,boolean,text)', 'EXECUTE'
          ) and (select prosecdef and proconfig @> array['search_path=pg_catalog']::text[]
                   and pg_catalog.strpos(
                     pg_catalog.pg_get_functiondef(oid),
                     'full lifecycle release gates require evidence-bound approval'
                   ) > 0
                  from pg_catalog.pg_proc
                 where oid = pg_catalog.to_regprocedure(
                   'public.decide_node_gate(uuid,boolean,text)'
                 )) as owner_gate_exact,
          not exists (
            select 1 from public.graph_artifacts
             where public.jsonb_has_sensitive_keys(payload)
                or pg_catalog.octet_length(payload::text) > 1048576
          ) as safe_artifacts,
          pg_catalog.to_regprocedure(
            'public.claim_planned_graph_v2(text,text[],text,jsonb,integer)'
          ) is not null as protocol_v2_installed
      `);
      expect(lineage.rows[0]).toEqual({
        audit_rows: 2,
        owner_gate_exact: true,
        safe_artifacts: true,
        protocol_v2_installed: true,
      });
    } finally {
      await db.close();
    }
  });
});
