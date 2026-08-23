// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The hosted apply workflow's surgical scopes, replayed against real PostgreSQL.
 *
 * `scope=broker-functions` and `scope=lifecycle` do not consult the ledger —
 * they run whole files with psql, on a database that has already had them. The
 * workflow's comments claim that is safe. This asks PostgreSQL instead, because
 * the claim has been wrong before: apply run 32272188607 died halfway through a
 * replay when `create or replace` met a widened return type, and left a
 * security migration unapplied behind it.
 *
 * Two properties matter, and they are different:
 *
 *   1. A replay must not DIE. Every file in a scope's list has to survive being
 *      run a second time against its own output.
 *   2. A replay must not resurrect a dropped overload. `claim_planned_graph`
 *      existed as `(text)` before 20260819001000 replaced it with
 *      `(text, text[])`. A second live overload has no symptom — PostgREST
 *      still resolves the named call — but a lifecycle graph claimed through
 *      the older body reports no gates and runs straight past every one of them.
 *
 * The file lists are parsed out of the workflow rather than copied, so a scope
 * that gains a migration is covered here without anyone remembering to add it.
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

async function replay(files: string[]): Promise<void> {
  for (const file of files) {
    try {
      await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
    } catch (error) {
      throw new Error(`${file} did not survive a replay: ${(error as Error).message}`);
    }
  }
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

describe("the workflow's surgical scopes", () => {
  it("names files that all exist", async () => {
    // Guards every assertion below against passing on an empty list.
    const known = new Set(await readdir(migrationsRoot));
    const broker = scopeFiles("Apply the broker function migrations surgically \\(scope=broker-functions\\)");
    const lifecycle = scopeFiles("Apply the Agentic SDLC lifecycle surgically \\(scope=lifecycle\\)");
    const widening = scopeFiles("Widen the lifecycle to ten stages \\(scope=ten-stage-lifecycle\\)");
    expect(broker.length).toBeGreaterThan(30);
    expect(lifecycle).toEqual([
      "20260821000100_agentic_sdlc_activity_types.sql",
      "20260821000200_agentic_sdlc_lifecycle.sql",
    ]);
    expect(widening).toEqual(["20260823000700_ten_stage_lifecycle.sql"]);
    expect([...broker, ...lifecycle, ...widening].filter((file) => !known.has(file))).toEqual([]);
  });

  it("leaves one claim_planned_graph, knowing about gates, once every migration has run", async () => {
    const overloads = await overloadsOf("claim_planned_graph");
    expect(
      overloads.map((entry) => entry.signature),
      "a second overload is a live claim that reports no gates",
    ).toEqual(["p_worker_id text, p_supported_executors text[]"]);
    expect(overloads[0].body).toContain("graph_gates");
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
    const query = /psql "\$DB_URL" -v ON_ERROR_STOP=1 -q -c "\r?\n(\s*with lifecycle\(kind[\s\S]*?);"/
      .exec(workflow);
    expect(query, "the scope=probe step no longer carries the lifecycle query").not.toBeNull();

    const rows = (await db.query<{ kind: string; object: string; present: boolean }>(
      query![1].replace(/^ {12}/gm, ""),
    )).rows;
    expect(rows.length).toBe(17);
    expect(
      rows.filter((row) => !row.present).map((row) => `${row.kind} ${row.object}`),
      "every migration has been applied, so the probe reporting any of these absent means the "
        + "probe is asking the wrong question — and an owner reading it would apply DDL twice.",
    ).toEqual([]);
  });

  it("survives a broker-functions replay without resurrecting the dropped overload", async () => {
    await replay(scopeFiles("Apply the broker function migrations surgically \\(scope=broker-functions\\)"));
    expect(
      (await overloadsOf("claim_planned_graph")).map((entry) => entry.signature),
      "20260819000100 recreates the one-argument overload; 20260819001000 runs after it in the "
        + "list and drops both. If that order ever changes, two overloads survive and the live "
        + "claim silently stops reporting gates.",
    ).toEqual(["p_worker_id text, p_supported_executors text[]"]);
  });

  it("does revert the lifecycle bodies, which is why the runbook says to re-run the scope", async () => {
    // Not a property worth having — a property worth knowing. The replay above
    // has just overwritten create_graph_from_plan with the pre-lifecycle body.
    // Asserting it here is what keeps the recovery test below from passing
    // vacuously, and what keeps the runbook's warning honest if it ever stops
    // being true.
    const [planner] = await overloadsOf("create_graph_from_plan");
    expect(planner.body).not.toContain("lifecycle_stage");
  });

  it("is fully restored by replaying the lifecycle scope afterwards", async () => {
    await replay(scopeFiles("Apply the Agentic SDLC lifecycle surgically \\(scope=lifecycle\\)"));

    const [planner] = await overloadsOf("create_graph_from_plan");
    expect(planner.body).toContain("lifecycle_stage");
    expect(planner.body).toContain("is_feedback");

    const claims = await overloadsOf("claim_planned_graph");
    expect(claims.map((entry) => entry.signature)).toEqual(["p_worker_id text, p_supported_executors text[]"]);
    expect(claims[0].body).toContain("graph_gates");

    // And the grants the drop-then-create discarded were put back. This is the
    // half that is easy to miss: `create or replace` preserves a function's
    // grants and `drop` does not, so adding a drop to a file that inherited its
    // grants from an earlier migration silently un-grants it. The symptom is a
    // bare 42501 from a function that plainly exists.
    const grants = await db.query<{ name: string; worker: boolean; member: boolean }>(
      `select routine.proname as name,
              has_function_privilege('service_role', routine.oid, 'EXECUTE') as worker,
              has_function_privilege('authenticated', routine.oid, 'EXECUTE') as member
         from pg_proc routine
         join pg_namespace space on space.oid = routine.pronamespace
        where space.nspname = 'public'
          and routine.proname in ('claim_planned_graph', 'create_graph_from_plan')
        order by 1`,
    );
    expect(grants.rows).toEqual([
      // The worker's claim: service_role only, never a signed-in member.
      { name: "claim_planned_graph", worker: true, member: false },
      // The console's launch: authenticated, through RLS and its own checks.
      { name: "create_graph_from_plan", worker: false, member: true },
    ]);
  });

  it("leaves the stage vocabulary widened, because the lifecycle file guards its own type", async () => {
    // The replay above re-ran 20260821000200, which creates sdlc_stage only if
    // it is absent. If that guard were ever dropped, this replay would restore
    // the eight-stage type underneath columns holding ten-stage values — and
    // the failure would not surface here but at the next insert.
    const labels = await db.query<{ enumlabel: string }>(
      `select label.enumlabel
         from pg_type kind_type
         join pg_namespace space on space.oid = kind_type.typnamespace
         join pg_enum label on label.enumtypid = kind_type.oid
        where space.nspname = 'public' and kind_type.typname = 'sdlc_stage'
        order by label.enumsortorder`,
    );
    expect(labels.rows.map((row) => row.enumlabel)).toEqual([
      "REQUIREMENT", "DISCOVER", "EVALUATE", "DECIDE", "ARCHITECT",
      "BUILD", "REVIEW", "TEST", "DEPLOY", "MONITOR",
    ]);
  });

  it("does revert the widened run projection, which is why the ten-stage scope must follow", async () => {
    // Another property worth knowing rather than having. 20260821000200 drops
    // and recreates list_graph_runs with its own narrower return type, so a
    // lifecycle replay silently takes the stage pages' projection back to the
    // fourteen-column shape. Every consumer of `depends_on` then reads
    // undefined and renders a node with no dependencies — wrong, and quiet.
    const [projection] = await overloadsOf("list_graph_runs");
    expect(projection.body).not.toContain("depends_on");
  });

  it("is restored by the ten-stage scope, which replays as a no-op on the type", async () => {
    await replay(scopeFiles("Widen the lifecycle to ten stages \\(scope=ten-stage-lifecycle\\)"));

    const [projection] = await overloadsOf("list_graph_runs");
    expect(projection.body).toContain("depends_on");
    expect(projection.body).toContain("anchor_count");
    // The grants the drop discarded, restated by the file rather than inherited.
    const grants = await db.query<{ member: boolean; worker: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated', routine.oid, 'EXECUTE') as member,
              has_function_privilege('service_role', routine.oid, 'EXECUTE') as worker,
              has_function_privilege('anon', routine.oid, 'EXECUTE') as anon
         from pg_proc routine
         join pg_namespace space on space.oid = routine.pronamespace
        where space.nspname = 'public' and routine.proname = 'list_graph_runs'`,
    );
    expect(grants.rows).toEqual([{ member: true, worker: false, anon: false }]);

    // And running it a second time against its own output changes nothing —
    // the guard returns early rather than dropping a type ten stages now
    // depend on.
    await replay(scopeFiles("Widen the lifecycle to ten stages \\(scope=ten-stage-lifecycle\\)"));
    const labels = await db.query<{ enumlabel: string }>(
      `select label.enumlabel
         from pg_type kind_type
         join pg_namespace space on space.oid = kind_type.typnamespace
         join pg_enum label on label.enumtypid = kind_type.oid
        where space.nspname = 'public' and kind_type.typname = 'sdlc_stage'
        order by label.enumsortorder`,
    );
    expect(labels.rows).toHaveLength(10);
    expect(labels.rows[0].enumlabel).toBe("REQUIREMENT");
  });
});
