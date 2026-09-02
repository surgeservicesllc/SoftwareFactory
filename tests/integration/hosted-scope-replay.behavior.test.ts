// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The hosted apply workflow's retired surgical scopes, checked against real
 * PostgreSQL after the versioned graph-worker cutover.
 *
 * Once 20260827000150 is in the ledger, replaying either legacy scope could
 * recreate worker-callable pre-protocol functions. The workflow must refuse
 * before its first file, the legacy claim must remain private, and only the
 * version-2 claim may remain service-callable.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");

let db: PGlite;
let workflow = "";

/** The files one `for FILE in \` list names, in the order the step runs them. */
function scopeFiles(stepName: string): string[] {
  const step = new RegExp(`- name: ${stepName}[\\s\\S]*?\\n      - name: `).exec(workflow)
    ?? new RegExp(`- name: ${stepName}[\\s\\S]*$`).exec(workflow);
  if (!step) return [];
  return [...step[0].matchAll(/supabase\/migrations\/(\S+\.sql)/g)].map((match) => match[1]);
}

function scopeStep(stepName: string): string {
  return new RegExp(`- name: ${stepName}[\\s\\S]*?\\n      - name: `).exec(workflow)?.[0]
    ?? new RegExp(`- name: ${stepName}[\\s\\S]*$`).exec(workflow)?.[0]
    ?? "";
}

async function overloadsOf(name: string): Promise<{ signature: string; body: string }[]> {
  const result = await db.query<{ signature: string; body: string }>(
    `select pg_get_function_identity_arguments(routine.oid) as signature,
            pg_get_functiondef(routine.oid) as body
       from pg_proc routine
       join pg_namespace space on space.oid = routine.pronamespace
      where space.nspname = 'public' and routine.proname = $1
      order by 1`,
    [name],
  );
  return result.rows;
}

beforeAll(async () => {
  workflow = await readFile(
    resolve(repositoryRoot, ".github/workflows/apply-hosted-migrations.yml"),
    "utf8",
  );
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
  for (const file of (await readdir(migrationsRoot)).filter((n) => /^\d+.*\.sql$/.test(n)).sort()) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the workflow's post-cutover surgical-scope fence", () => {
  it("keeps the authority fence and v2 lineage in separate one-file scopes", () => {
    expect(scopeFiles("Fence the legacy graph protocol \\(scope=graph-protocol-fence\\)")).toEqual([
      "20260827000150_fence_legacy_graph_protocol.sql",
    ]);
    expect(scopeFiles("Install graph Phase 1C release lineage \\(scope=graph-phase1c-lineage\\)")).toEqual([
      "20260827000200_graph_phase1c_release_lineage.sql",
    ]);

    const fence = scopeStep("Fence the legacy graph protocol \\(scope=graph-protocol-fence\\)");
    const lineage = scopeStep("Install graph Phase 1C release lineage \\(scope=graph-phase1c-lineage\\)");
    expect(fence).toContain('if [ "$LEDGER" != "1|0|0" ]');
    expect(fence).not.toContain("20260827000200_graph_phase1c_release_lineage.sql");
    expect(lineage).toContain('if [ "$LEDGER" != "1|1|0" ]');
    expect(lineage).not.toContain("20260827000150_fence_legacy_graph_protocol.sql");
    expect(lineage.indexOf("DRAINED=$(psql")).toBeLessThan(lineage.indexOf("--single-transaction"));
  });

  it("names files that all exist", async () => {
    // Guards every assertion below against passing on an empty list.
    const known = new Set(await readdir(migrationsRoot));
    const broker = scopeFiles("Apply the broker function migrations surgically \\(scope=broker-functions\\)");
    const lifecycle = scopeFiles("Apply the Agentic SDLC lifecycle surgically \\(scope=lifecycle\\)");
    expect(broker.length).toBeGreaterThan(30);
    expect(lifecycle).toEqual([
      "20260821000100_agentic_sdlc_activity_types.sql",
      "20260821000200_agentic_sdlc_lifecycle.sql",
    ]);
    expect([...broker, ...lifecycle].filter((file) => !known.has(file))).toEqual([]);
  });

  it.each([
    "Apply the broker function migrations surgically \\(scope=broker-functions\\)",
    "Apply the Agentic SDLC lifecycle surgically \\(scope=lifecycle\\)",
  ])("refuses %s before replay once the cutover ledger is present", (stepName) => {
    const step = scopeStep(stepName);
    expect(step).toContain("version >= '20260827000150'");
    expect(step).toContain('if [ "$CUTOVER_APPLIED" = "t" ]');
    expect(step).toMatch(/retired after the versioned graph protocol cutover/i);
    expect(step.indexOf("CUTOVER_APPLIED=")).toBeGreaterThan(-1);
    expect(step.indexOf("CUTOVER_APPLIED=")).toBeLessThan(step.indexOf("for FILE in"));
    expect(step.indexOf("exit 1")).toBeLessThan(step.indexOf("for FILE in"));
  });

  it("keeps each claim name unambiguous and exposes only protocol v3 to the worker", async () => {
    const legacy = await overloadsOf("claim_planned_graph");
    expect(legacy.map((entry) => entry.signature)).toEqual([
      "p_worker_id text, p_supported_executors text[]",
    ]);
    const internal = await overloadsOf("claim_planned_graph_internal");
    expect(internal.map((entry) => entry.signature)).toEqual([
      "p_worker_id text, p_supported_executors text[], p_repository_full_name text, p_required_check_names jsonb",
    ]);
    const v2 = await overloadsOf("claim_planned_graph_v2");
    expect(v2.map((entry) => entry.signature)).toEqual([
      "p_worker_id text, p_supported_executors text[], p_repository_full_name text, p_required_check_names jsonb, p_protocol_version integer",
    ]);
    expect(legacy[0].body).toContain("graph_gates");
    expect(internal[0].body).toContain("p_repository_full_name");
    expect(internal[0].body).toContain("p_required_check_names");
    expect(v2[0].body).toContain("p_repository_full_name");
    expect(v2[0].body).toContain("p_required_check_names");
    expect(v2[0].body).toContain("protocol version 2 is required");
    const v3 = await overloadsOf("claim_planned_graph_v3");
    expect(v3.map((entry) => entry.signature)).toEqual([
      "p_worker_id text, p_supported_executors text[], p_repository_full_name text, p_required_check_names jsonb, p_protocol_version integer",
    ]);
    expect(v3[0].body).toContain("protocol version 3 is required");

    const privileges = await db.query<{
      legacy_authenticated: boolean;
      internal_authenticated: boolean;
      internal_service: boolean;
      legacy_service: boolean;
      v2_authenticated: boolean;
      v2_service: boolean;
      v3_authenticated: boolean;
      v3_service: boolean;
    }>(
      `select
         has_function_privilege('authenticated', 'public.claim_planned_graph(text,text[])', 'EXECUTE') as legacy_authenticated,
         has_function_privilege('service_role', 'public.claim_planned_graph(text,text[])', 'EXECUTE') as legacy_service,
         has_function_privilege('authenticated', 'public.claim_planned_graph_internal(text,text[],text,jsonb)', 'EXECUTE') as internal_authenticated,
         has_function_privilege('service_role', 'public.claim_planned_graph_internal(text,text[],text,jsonb)', 'EXECUTE') as internal_service,
         has_function_privilege('authenticated', 'public.claim_planned_graph_v2(text,text[],text,jsonb,integer)', 'EXECUTE') as v2_authenticated,
         has_function_privilege('service_role', 'public.claim_planned_graph_v2(text,text[],text,jsonb,integer)', 'EXECUTE') as v2_service,
         has_function_privilege('authenticated', 'public.claim_planned_graph_v3(text,text[],text,jsonb,integer)', 'EXECUTE') as v3_authenticated,
         has_function_privilege('service_role', 'public.claim_planned_graph_v3(text,text[],text,jsonb,integer)', 'EXECUTE') as v3_service`,
    );
    expect(privileges.rows[0]).toEqual({
      legacy_authenticated: false,
      internal_authenticated: false,
      internal_service: false,
      legacy_service: false,
      v2_authenticated: false,
      v2_service: false,
      v3_authenticated: false,
      v3_service: true,
    });
  });

  it("asks its probe questions in SQL that actually runs, and gets t for every one", async () => {
    /*
     * The probe is read-only, so a mistake in it is not destructive — it is
     * worse than that. A query that fails to parse costs a production dispatch;
     * a query that parses but asks the wrong question prints `f` for an object
     * that exists, and the reading an owner takes from that is "apply it",
     * against a database that already has it. Run 32068091179 is what that
     * looks like. So the query is lifted out of the workflow and run here,
     * against a database where every migration has just been applied: every
     * row must come back present.
     */
    // The probe's SQL lives in .github/hosted-apply/probe/ (extracted to keep
    // the workflow under GitHub's 500KB ceiling); the workflow must still run
    // the exact file this test executes, or the two could drift apart.
    expect(workflow, "the scope=probe step no longer runs the lifecycle query file")
      .toContain("-f .github/hosted-apply/probe/08.sql");
    const lifecycleSql = await readFile(
      resolve(repositoryRoot, ".github/hosted-apply/probe/08.sql"),
      "utf8",
    );
    expect(lifecycleSql).toContain("with lifecycle(kind");
    expect(lifecycleSql).toContain(
      "('body',     'claim_planned_graph_v2',      'protocol version 2 is required')",
    );
    expect(lifecycleSql).not.toContain("('body',     'claim_planned_graph',");

    const rows = (await db.query<{ kind: string; object: string; present: boolean }>(
      lifecycleSql,
    )).rows;
    expect(rows.length).toBe(14);
    expect(
      rows.filter((row) => !row.present).map((row) => `${row.kind} ${row.object}`),
      "every migration has been applied, so the probe reporting any of these absent means the "
        + "probe is asking the wrong question — and an owner reading it would apply DDL twice.",
    ).toEqual([]);
  });

  it("executes every extracted probe file against the migrated database", async () => {
    /*
     * Run 33297041401 is why this exists: an extraction that mangles even one
     * probe file fails only at a production dispatch, because nothing else
     * ever executes the files. So every file runs here, against the fully
     * migrated chain — a syntax error, a swallowed shell fragment, or a
     * reference to an object the chain does not create fails this test
     * instead of a dispatch. The hosted ledger schema is stubbed because the
     * chain applies migrations directly rather than through the supabase CLI.
     */
    await db.exec(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text primary key);
    `);
    const probeDirectory = resolve(repositoryRoot, ".github/hosted-apply/probe");
    const files = (await readdir(probeDirectory)).filter((name) => name.endsWith(".sql")).sort();
    expect(files.length).toBe(44);
    for (const file of files) {
      // The workflow must run the exact file this test proves executable.
      expect(workflow).toContain(`-f .github/hosted-apply/probe/${file}`);
      const sql = await readFile(resolve(probeDirectory, file), "utf8");
      try {
        await db.exec(sql);
      } catch (error) {
        throw new Error(`probe file ${file} does not execute: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  it("executes every extracted postflight file, and each one refuses when it should", async () => {
    /*
     * The CRM scopes' postflight checks were extracted for the same reason
     * the probe SQL was: the workflow is measured against a 490,000-byte
     * guard and adding a scope's verification inline was going to breach it.
     * Extraction moves the same hazard with it — nothing else executes these
     * files, so a mangled one fails only at a production dispatch.
     *
     * Running them here proves two things at once. Each file executes
     * against the fully migrated chain, and each one is a real assertion
     * rather than a no-op: the whole point of a postflight is that it
     * RAISES when the schema is wrong, so one of them is run against a
     * deliberately broken schema and must fail.
     */
    const directory = resolve(repositoryRoot, ".github/hosted-apply/postflight");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    expect(files).toEqual([
      "agentos-foundation.sql",
      "application-kit.sql",
      "application-transitions.sql",
      "autopay-authorization.sql",
      "billing-contracts.sql",
      "branches-org-sales.sql",
      "chemicals-compliance.sql",
      "commercial-portal.sql",
      "conversation-routing.sql",
      "customer-portal.sql",
      "customers-side.sql",
      "data-you-own.sql",
      "day-route.sql",
      "document-polish.sql",
      "documents-canvassing-marketing.sql",
      "equipment-fleet.sql",
      "explainable-scoring.sql",
      "field-offline-queue.sql",
      "followups.sql",
      "forms-conditions.sql",
      "forms-timesheets-licences.sql",
      "invoice-from-visit.sql",
      "job-profitability.sql",
      "knowledge-base.sql",
      "multi-unit-properties.sql",
      "nothing-hidden.sql",
      "operating-dashboards.sql",
      "pest-ipm.sql",
      "plan-sequencing.sql",
      "portal-filed-documents.sql",
      "posting-recheck.sql",
      "posting-sightings.sql",
      "queue-diagnosis-visibility.sql",
      "record-only-boundary.sql",
      "record-only-functions.sql",
      "recurring-billing.sql",
      "revenue-forecast.sql",
      "schedule-bends.sql",
      "secret-guard-restricted-keys.sql",
      "service-documents.sql",
      "service-integrations.sql",
      "transactional-notices.sql",
      "truck-stock.sql",
      "trust.sql",
      "wdo-inspections.sql",
    ]);

    for (const file of files) {
      // The workflow must run the exact file this test proves executable,
      // and must no longer carry the SQL inline.
      expect(workflow).toContain(`-f .github/hosted-apply/postflight/${file}`);
      const sql = await readFile(resolve(directory, file), "utf8");
      try {
        await db.exec(sql);
      } catch (error) {
        throw new Error(
          `postflight file ${file} does not execute against the migrated chain: `
            + (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    /*
     * And the check has teeth. Granting `authenticated` the DELETE that the
     * portal's postflight exists to forbid must make that file fail — a
     * postflight that passes on a broken schema is worse than none, because
     * it is read as proof.
     */
    await db.exec("grant delete on table public.crm_portal_requests to authenticated");
    const portal = await readFile(resolve(directory, "customer-portal.sql"), "utf8");
    await expect(db.exec(portal)).rejects.toThrow(/portal records are deletable/);
    await db.exec("revoke delete on table public.crm_portal_requests from authenticated");
    await db.exec(portal);
  });

});
