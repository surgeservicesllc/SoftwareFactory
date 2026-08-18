// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The standard model catalogue seed, against the real migrated schema.
 *
 * `set_agent_provider_assignment` only accepts enabled catalogue
 * configurations, and organizations start with an empty catalogue — which is
 * exactly the state the hosted deployment was stuck in: every Agents-page
 * select offered only "Automatic routing". Migration 20260818000200 seeds
 * the standard models for every organization that exists when it runs, and
 * the hosted surgical path RE-RUNS listed files, so the same file must also
 * be a no-op the second time and must coexist with rows an organization
 * already seeded through the console.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const seedFile = resolve(migrationsDirectory, "20260818000200_seed_standard_model_catalogue.sql");

const ownerId = "00000000-0000-4000-8000-0000000000c1";
const organizationId = "10000000-0000-4000-8000-0000000000c1";

describe("the standard model catalogue seed", { timeout: 180_000 }, () => {
  let db: PGlite;
  let seedSql = "";

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const files = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }
    seedSql = await readFile(seedFile, "utf8");

    // The organization is created AFTER the chain applied, which is exactly
    // the hosted shape at re-apply time: existing organizations, listed file
    // re-run by the surgical path.
    await db.exec(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-catalogue', '${ownerId}');
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("seeds eight standard models per organization, replays as a no-op, and makes agents assignable", async () => {
    // Chain ran before the organization existed: nothing seeded yet.
    const before = await db.query<{ count: number }>(
      "select count(*)::int as count from public.provider_model_configurations where organization_id = $1",
      [organizationId],
    );
    expect(before.rows[0].count).toBe(0);

    // The surgical re-run seeds the now-existing organization.
    await db.exec(seedSql);
    const seeded = await db.query<{ provider: string; model: string; enabled: boolean }>(
      "select provider::text, model, enabled from public.provider_model_configurations where organization_id = $1 order by provider, model",
      [organizationId],
    );
    expect(seeded.rows).toHaveLength(8);
    expect(seeded.rows.every((row) => row.enabled)).toBe(true);
    expect(seeded.rows.map((row) => row.model)).toContain("claude-opus-5");
    expect(seeded.rows.filter((row) => row.provider === "openai")).toHaveLength(4);

    // Replay is a no-op: same eight rows, no duplicates, no error.
    await db.exec(seedSql);
    const replayed = await db.query<{ count: number }>(
      "select count(*)::int as count from public.provider_model_configurations where organization_id = $1",
      [organizationId],
    );
    expect(replayed.rows[0].count).toBe(8);

    // The payoff the whole seed exists for: an agent becomes assignable.
    const agent = await db.query<{ id: string }>(
      "select id from public.agents where organization_id = $1 order by created_at limit 1",
      [organizationId],
    );
    expect(agent.rows).toHaveLength(1);

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
    await db.exec("set role authenticated");
    const assigned = await db.query<{ provider: string; model: string }>(
      "select provider::text, model from public.set_agent_provider_assignment($1::uuid, 'anthropic', 'claude-opus-5')",
      [agent.rows[0].id],
    );
    await db.exec("reset role");

    expect(assigned.rows[0]).toEqual({ provider: "anthropic", model: "claude-opus-5" });
  });

  /*
   * No test for a manager-less organization: the membership trigger refuses
   * to delete the last owner ("an organization must retain at least one
   * owner"), so the migration's lateral-join skip path is unreachable
   * belt-and-suspenders — every organization has someone to attribute the
   * seeded rows to, by the schema's own guarantee.
   */
});
