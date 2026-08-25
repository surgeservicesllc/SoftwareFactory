// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BOARD_SEARCH_ADAPTERS } from "@/lib/job-seeker/board-search/registry";

/**
 * What happens to a search result after someone saves it, as the database
 * sees it.
 *
 * The route tests prove the boundary refuses the wrong callers; they cannot
 * prove the storage claims, because they mock the client away. These run the
 * real migration chain in real PostgreSQL and exercise the claims Search
 * actually rests on:
 *
 *  - the board key is storable in `source`, so attribution survives;
 *  - saving the same posting twice is caught by the schema, not by the route;
 *  - a saved job is private to the person who saved it, even inside one
 *    tenant;
 *  - what was saved is still there on a later read — the "refresh and verify"
 *    half of the workflow, at the layer where it is actually true.
 *
 * There is deliberately no local Supabase stack here, so this is the strongest
 * verification available in CI. The signed-in browser journey is a separate,
 * gated spec.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

const organizationId = "44444444-4444-4444-8444-444444444444";
const ownerId = "55555555-5555-4555-8555-555555555555";
const colleagueId = "66666666-6666-4666-8666-666666666666";

async function assumeUser(db: PGlite, userId: string) {
  await db.exec(`
    set role authenticated;
    select set_config('request.jwt.claim.sub', '${userId}', false);
    select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false);
  `);
}

async function reset(db: PGlite) {
  await db.exec(`
    reset role;
    select set_config('request.jwt.claim.sub', '', false);
    select set_config('request.jwt.claims', '', false);
  `);
}

describe("saving a search result", { timeout: 180_000 }, () => {
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

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${colleagueId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Search Tenant', 'search-tenant', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${colleagueId}', 'member')
      on conflict do nothing;
    `);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  async function saveJob(
    userId: string,
    source: string,
    job: { title: string; company: string; externalId: string | null; url?: string | null },
  ) {
    return db.query(
      `insert into public.job_seeker_jobs
         (organization_id, user_id, source, external_id, url, title, company, location)
       values ($1, $2, $3, $4, $5, $6, $7, 'København')`,
      [organizationId, userId, source, job.externalId, job.url ?? null, job.title, job.company],
    );
  }

  it("stores every board key the registry offers", async () => {
    /*
     * `source` has a CHECK — `^[a-z][a-z0-9_]{0,62}$`. A board whose key does
     * not satisfy it would be unsavable, and the failure would appear only
     * when someone clicked Save on that board's results. Reading the keys from
     * the registry means adding a board is covered by this without anyone
     * remembering to extend the list.
     */
    await assumeUser(db, ownerId);
    for (const adapter of BOARD_SEARCH_ADAPTERS) {
      await saveJob(ownerId, adapter.key, {
        title: `Engineer via ${adapter.key}`,
        company: "Nordisk Teknik A/S",
        externalId: `ext-${adapter.key}`,
      });
    }
    const stored = await db.query<{ source: string }>(
      "select source from public.job_seeker_jobs where organization_id = $1 order by source",
      [organizationId],
    );
    expect(stored.rows.map((row) => row.source).sort()).toEqual(
      BOARD_SEARCH_ADAPTERS.map((adapter) => adapter.key).sort(),
    );
    await reset(db);
  });

  it("keeps the board's name on the row rather than calling it manual", async () => {
    await assumeUser(db, ownerId);
    const row = await db.query<{ source: string }>(
      "select source from public.job_seeker_jobs where external_id = 'ext-jobnet'",
    );
    expect(row.rows[0]?.source).toBe("jobnet");
    await reset(db);
  });

  it("refuses the same posting twice through the schema, not the route", async () => {
    /*
     * This is why the save route can report "already saved" as a state rather
     * than checking first: the unique index is the authority, and a check-then-
     * insert would race itself between two tabs.
     */
    await assumeUser(db, ownerId);
    await expect(
      saveJob(ownerId, "jobnet", {
        title: "Engineer via jobnet",
        company: "Nordisk Teknik A/S",
        externalId: "ext-jobnet",
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
    await reset(db);
  });

  it("refuses a link that is not http, so a saved title cannot become a script", async () => {
    await assumeUser(db, ownerId);
    await expect(
      saveJob(ownerId, "jobnet", {
        title: "Hostile posting",
        company: "Nowhere Ltd",
        externalId: "ext-hostile",
        url: "javascript:alert(1)",
      }),
    ).rejects.toThrow();
    await reset(db);
  });

  it("keeps a saved job private to the person who saved it", async () => {
    // Career data is personal even inside one tenant. A colleague in the same
    // organization must not see what someone else is applying for.
    await assumeUser(db, colleagueId);
    const theirs = await db.query(
      "select id from public.job_seeker_jobs where organization_id = $1",
      [organizationId],
    );
    expect(theirs.rows).toHaveLength(0);
    await reset(db);
  });

  it("is still there on a later read, which is the half a refresh proves", async () => {
    await assumeUser(db, ownerId);
    const again = await db.query<{ title: string; source: string; location: string }>(
      `select title, source, location from public.job_seeker_jobs
        where organization_id = $1 and external_id = 'ext-jobindex'`,
      [organizationId],
    );
    expect(again.rows[0]).toMatchObject({ source: "jobindex", location: "København" });
    await reset(db);
  });

  it("refuses a signed-out reader the table outright, not merely its rows", async () => {
    /*
     * Written expecting an empty result and corrected to what actually
     * happens, because the difference is the point: `anon` holds no grant on
     * `job_seeker_jobs` at all, so the refusal is a permission error before
     * row level security is consulted. An empty result would mean the table
     * was readable and simply had nothing for this reader — one lock rather
     * than two, and the weaker one.
     */
    await db.exec("set role anon;");
    await expect(db.query("select id from public.job_seeker_jobs")).rejects.toThrow(
      /permission denied/i,
    );
    await reset(db);
  });
});
