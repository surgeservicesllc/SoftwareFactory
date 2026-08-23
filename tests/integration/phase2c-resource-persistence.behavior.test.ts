// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FAULT_THRESHOLDS } from "@/lib/resources/breakers";

/**
 * Proof that the Resource Manager's memory works, against the real migrated
 * schema rather than against a copy of the rule.
 *
 * The reason this exists at all: a circuit breaker that lives in one request's
 * memory reopens every request, so three consecutive outages spread across
 * three requests never reach the threshold and the breaker can never fire.
 * These tests drive the faults through separate calls for exactly that reason —
 * a single-call test would pass against the in-memory version too and prove
 * nothing about the defect being fixed.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000e001";
const outsiderId = "00000000-0000-4000-8000-00000000e002";
const organizationId = "10000000-0000-4000-8000-00000000e001";
const projectId = "40000000-0000-4000-8000-00000000e001";
const nodeId = "60000000-0000-4000-8000-00000000e001";

async function actAs(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

describe("Phase 2C resource persistence", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    expect(migrationFiles.at(-1)).toBe("20260822001300_contract_project_lifecycle_function_acls.sql");
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Resource Factory', 'resource-factory', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, github_repository, default_branch, created_by)
        values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'surgeservicesllc/SoftwareFactory', 'main', '${ownerId}');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("opens a breaker across separate calls, which is the whole point of storing it", async () => {
    await actAs(db, ownerId);

    // `outage` opens at three. Each call is a separate transaction, standing in
    // for the separate requests that defeated the in-memory version.
    expect(FAULT_THRESHOLDS.outage).toBe(3);

    const results = [];
    for (let attempt = 0; attempt < FAULT_THRESHOLDS.outage; attempt += 1) {
      const { rows } = await db.query<{ state: string; consecutive_faults: number; opened: boolean; reason: string }>(
        `select state, consecutive_faults, opened, reason
         from public.record_resource_breaker_fault($1::uuid, 'openai/gpt-5.3-codex', 'outage', $2::integer)`,
        [organizationId, FAULT_THRESHOLDS.outage],
      );
      results.push(rows[0]);
    }

    expect(results.map((row) => row.state)).toEqual(["closed", "closed", "open"]);
    // The count survives between calls. That is the entire fix: an in-memory
    // breaker reads zero every request and reaches no threshold ever.
    expect(results.map((row) => row.consecutive_faults)).toEqual([1, 2, 3]);
    expect(results.at(-1)?.opened).toBe(true);
    expect(results.at(-1)?.reason).toBe("3 consecutive outage failures.");
  });

  it("records the opening as a transition, and records nothing for the faults below it", async () => {
    await actAs(db, ownerId);
    const { rows } = await db.query<{ from_state: string; to_state: string; fault: string }>(
      `select from_state, to_state, fault from public.resource_breaker_events
       where target = 'openai/gpt-5.3-codex' order by occurred_at`,
      [],
    );

    // One event, not three: a fault that changes no state is not a transition,
    // and recording each would bury the opening that matters.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_state: "closed", to_state: "open", fault: "outage" });
  });

  it("restarts counting when the fault class changes", async () => {
    await actAs(db, ownerId);

    // Two rate limits would open a breaker on their own; one does not.
    const { rows: first } = await db.query<{ state: string; consecutive_faults: number }>(
      `select state, consecutive_faults
       from public.record_resource_breaker_fault($1::uuid, 'anthropic', 'rate_limit', $2::integer)`,
      [organizationId, FAULT_THRESHOLDS.rate_limit],
    );
    expect(first[0].state).toBe("closed");

    // A different symptom is not corroboration of the first, so the count
    // restarts at one rather than reaching the outage threshold of three.
    const { rows: second } = await db.query<{ state: string; consecutive_faults: number }>(
      `select state, consecutive_faults
       from public.record_resource_breaker_fault($1::uuid, 'anthropic', 'outage', $2::integer)`,
      [organizationId, FAULT_THRESHOLDS.outage],
    );
    expect(second[0].state).toBe("closed");
    expect(second[0].consecutive_faults).toBe(1);
  });

  it("closes on success and records that transition too", async () => {
    await actAs(db, ownerId);
    const { rows } = await db.query<{ state: string; closed: boolean }>(
      `select state, closed from public.record_resource_breaker_success($1::uuid, 'openai/gpt-5.3-codex')`,
      [organizationId],
    );
    expect(rows[0]).toMatchObject({ state: "closed", closed: true });

    const { rows: events } = await db.query<{ from_state: string; to_state: string }>(
      `select from_state, to_state from public.resource_breaker_events
       where target = 'openai/gpt-5.3-codex' order by occurred_at`,
    );
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ from_state: "open", to_state: "closed" });

    const { rows: state } = await db.query<{ consecutive_faults: number; opened_at: string | null; reason: string | null }>(
      `select consecutive_faults, opened_at, reason from public.resource_breakers where target = 'openai/gpt-5.3-codex'`,
    );
    expect(state[0]).toMatchObject({ consecutive_faults: 0, opened_at: null, reason: null });
  });

  it("creates no row for a target that has never failed", async () => {
    await actAs(db, ownerId);
    const { rows } = await db.query<{ breaker_id: string | null; closed: boolean }>(
      `select breaker_id, closed from public.record_resource_breaker_success($1::uuid, 'never-used-provider')`,
      [organizationId],
    );
    expect(rows[0]).toMatchObject({ breaker_id: null, closed: false });

    const { rows: absent } = await db.query(
      `select 1 from public.resource_breakers where target = 'never-used-provider'`,
    );
    expect(absent).toHaveLength(0);
  });

  it("stores an assignment and refuses to name a worker on a non-assignment", async () => {
    await actAs(db, ownerId);

    const { rows } = await db.query<{ record_resource_assignment: string }>(
      `select public.record_resource_assignment(
         $1::uuid, $2::uuid, 'ASSIGNED', 'BALANCED', 'AUTO',
         'Highest score on capability fit and observed performance.', 'phase2c-resource-manager-v1',
         'engineer', 'openai', 'gpt-5.3-codex', $3::jsonb, 0.8125, true)`,
      [projectId, nodeId, JSON.stringify([{ agentId: "engineer", eligible: true, score: 0.81 }])],
    );
    expect(rows[0].record_resource_assignment).toBeTruthy();

    // A decision that routed nothing must not name a worker, or the record
    // would imply work went somewhere it did not.
    await expect(
      db.query(
        `select public.record_resource_assignment(
           $1::uuid, $2::uuid, 'NO_ELIGIBLE_WORKER', 'QUALITY', 'AUTO',
           'No candidate satisfied capability, availability, risk, and breaker requirements.',
           'phase2c-resource-manager-v1', 'engineer', 'openai', 'gpt-5.3-codex')`,
        [projectId, nodeId],
      ),
    ).rejects.toThrow(/resource_assignments_worker_matches_decision/);
  });

  it("refuses a success rate on an unevidenced prediction", async () => {
    await actAs(db, ownerId);
    // `history.ts` returns null below its minimum sample count precisely so
    // nothing invents a rate; persisting one anyway would undo that.
    await expect(
      db.query(
        `select public.record_resource_assignment(
           $1::uuid, $2::uuid, 'ASSIGNED', 'SPEED', 'AUTO', 'No recorded history yet.',
           'phase2c-resource-manager-v1', 'engineer', 'openai', 'gpt-5.3-codex',
           '[]'::jsonb, 0.99, false)`,
        [projectId, nodeId],
      ),
    ).rejects.toThrow(/resource_assignments_prediction_is_evidenced/);
  });

  it("refuses credential-shaped text in a stored model or target", async () => {
    await actAs(db, ownerId);
    await expect(
      db.query(
        `select public.record_resource_assignment(
           $1::uuid, $2::uuid, 'ASSIGNED', 'COST', 'AUTO', 'Cheapest eligible worker.',
           'phase2c-resource-manager-v1', 'engineer', 'openai', $3::text)`,
        [projectId, nodeId, `sk-${"a".repeat(48)}`],
      ),
    ).rejects.toThrow(/resource_assignments_model_check|text_has_likely_secret|violates check constraint/);
  });

  it("keeps both records append-only", async () => {
    await actAs(db, ownerId);
    await db.exec("reset role");

    await expect(
      db.query(`update public.resource_assignments set reason = 'rewritten'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query(`delete from public.resource_breaker_events`),
    ).rejects.toThrow(/append-only/);
  });

  it("shows nothing to a member of another organization, and nothing to anon", async () => {
    await actAs(db, outsiderId);
    const { rows: assignments } = await db.query(`select 1 from public.resource_assignments`);
    const { rows: breakers } = await db.query(`select 1 from public.resource_breakers`);
    expect(assignments).toHaveLength(0);
    expect(breakers).toHaveLength(0);

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role anon");
    await expect(db.query(`select 1 from public.resource_assignments`)).rejects.toThrow(/permission denied/);

    await db.exec("reset role");
  });

  it("grants service_role no privilege on either table", async () => {
    await db.exec("reset role");
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants
       where grantee = 'service_role'
         and table_name in ('resource_breakers', 'resource_breaker_events', 'resource_assignments')`,
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses to write for a caller outside the organization", async () => {
    await actAs(db, outsiderId);
    await expect(
      db.query(
        `select public.record_resource_breaker_fault($1::uuid, 'openai', 'outage', 3)`,
        [organizationId],
      ),
    ).rejects.toThrow(/not a member/);
  });
});
