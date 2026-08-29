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
const outsiderId = "77777777-7777-4777-8777-777777777777";

const validBreakdown = {
  experience: 30,
  skills: 20,
  leadership: 15,
  industry: 10,
  compensation: 5,
  location: 5,
  career_growth: 0,
} as const;

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
      insert into auth.users (id) values ('${ownerId}'), ('${colleagueId}'), ('${outsiderId}');
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

  async function recordJob(
    externalId: string,
    overrides: Readonly<{
      breakdown?: Readonly<Record<string, number>>;
      qualified?: boolean;
      score?: number;
      threshold?: number;
    }> = {},
  ) {
    const score = overrides.score ?? 85;
    const threshold = overrides.threshold ?? 80;
    const qualified = overrides.qualified ?? score >= threshold;

    return db.query<{
      outcome: "recorded" | "duplicate";
      job_id: string | null;
      score: number | null;
      qualified: boolean | null;
    }>(
      `select * from public.record_job_seeker_job(
        $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
        $7::text, $8::text, $9::public.job_seeker_arrangement, $10::text,
        $11::integer, $12::jsonb, $13::jsonb, $14::jsonb, $15::integer,
        $16::boolean
      )`,
      [
        organizationId,
        "jobnet",
        externalId,
        `https://jobnet.example/jobs/${externalId}`,
        `Atomic Engineer ${externalId}`,
        "Transactional Systems A/S",
        "DKK 900,000",
        "København",
        "hybrid",
        "Build reliable systems.",
        score,
        JSON.stringify(overrides.breakdown ?? validBreakdown),
        JSON.stringify(["Strong experience match"]),
        JSON.stringify(["No material gaps"]),
        threshold,
        qualified,
      ],
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

  it("records the job, score, pipeline entry, and immutable activity evidence atomically", async () => {
    await assumeUser(db, ownerId);
    const result = await recordJob("atomic-success");
    expect(result.rows).toEqual([
      expect.objectContaining({ outcome: "recorded", score: 85, qualified: true }),
    ]);

    const recordedId = result.rows[0]?.job_id;
    expect(recordedId).toEqual(expect.any(String));
    await reset(db);
    const state = await db.query<{
      job_user: string;
      match_user: string;
      application_user: string;
      stage: string;
      event_type: string;
      actor_user_id: string;
      metadata: Record<string, unknown>;
    }>(
      `select jobs.user_id::text as job_user,
              matches.user_id::text as match_user,
              applications.user_id::text as application_user,
              applications.stage::text,
              events.event_type::text,
              events.actor_user_id::text,
              events.metadata
         from public.job_seeker_jobs jobs
         join public.job_seeker_matches matches on matches.job_id = jobs.id
         join public.job_seeker_applications applications on applications.job_id = jobs.id
         join public.activity_events events
           on events.entity_type = 'job_seeker_job' and events.entity_id = jobs.id
        where jobs.id = $1`,
      [recordedId],
    );
    expect(state.rows).toEqual([
      expect.objectContaining({
        job_user: ownerId,
        match_user: ownerId,
        application_user: ownerId,
        stage: "QUALIFIED",
        event_type: "job_seeker.job_recorded",
        actor_user_id: ownerId,
        metadata: expect.objectContaining({
          job_id: recordedId,
          source: "jobnet",
          score: 85,
          qualified: true,
          application_stage: "QUALIFIED",
        }),
      }),
    ]);
  });

  it("returns a safe duplicate result without creating any partial children or extra event", async () => {
    await assumeUser(db, ownerId);
    expect((await recordJob("atomic-duplicate")).rows[0]?.outcome).toBe("recorded");
    expect((await recordJob("atomic-duplicate")).rows).toEqual([
      { outcome: "duplicate", job_id: null, score: null, qualified: null },
    ]);
    await reset(db);

    const counts = await db.query<{ jobs: number; matches: number; applications: number; events: number }>(
      `select
         (select count(*)::integer from public.job_seeker_jobs where external_id = 'atomic-duplicate') as jobs,
         (select count(*)::integer from public.job_seeker_matches matches
            join public.job_seeker_jobs jobs on jobs.id = matches.job_id
           where jobs.external_id = 'atomic-duplicate') as matches,
         (select count(*)::integer from public.job_seeker_applications applications
            join public.job_seeker_jobs jobs on jobs.id = applications.job_id
           where jobs.external_id = 'atomic-duplicate') as applications,
         (select count(*)::integer from public.activity_events events
            join public.job_seeker_jobs jobs on jobs.id = events.entity_id
           where events.entity_type = 'job_seeker_job'
             and events.event_type = 'job_seeker.job_recorded'
             and jobs.external_id = 'atomic-duplicate') as events`,
    );
    expect(counts.rows[0]).toEqual({ jobs: 1, matches: 1, applications: 1, events: 1 });
  });

  it("rolls the job back when any child row fails validation", async () => {
    await assumeUser(db, ownerId);
    await expect(
      recordJob("atomic-child-failure", { breakdown: { experience: 30 }, score: 30, threshold: 80 }),
    ).rejects.toThrow(/breakdown|check constraint/i);
    await reset(db);

    const remnants = await db.query<{ jobs: number; events: number }>(
      `select
         (select count(*)::integer from public.job_seeker_jobs
           where external_id = 'atomic-child-failure') as jobs,
         (select count(*)::integer from public.activity_events
           where event_type = 'job_seeker.job_recorded'
             and metadata ->> 'source' = 'jobnet'
             and entity_id in (select id from public.job_seeker_jobs
               where external_id = 'atomic-child-failure')) as events`,
    );
    expect(remnants.rows[0]).toEqual({ jobs: 0, events: 0 });
  });

  it("derives ownership from auth.uid and refuses a caller outside the organization", async () => {
    await assumeUser(db, outsiderId);
    await expect(recordJob("atomic-outsider")).rejects.toThrow(/organization membership is required/i);
    await reset(db);

    const rows = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.job_seeker_jobs where external_id = 'atomic-outsider'",
    );
    expect(rows.rows[0]?.count).toBe(0);
  });

  it("prevents direct child rows from pointing at another person's job", async () => {
    await assumeUser(db, ownerId);
    const ownerJob = await db.query<{ id: string }>(
      `insert into public.job_seeker_jobs
         (organization_id, user_id, source, external_id, title, company)
       values ($1, $2, 'manual', 'owner-only-parent', 'Owner job', 'Owner company')
       returning id`,
      [organizationId, ownerId],
    );
    const ownerJobId = ownerJob.rows[0]?.id;
    await reset(db);

    await assumeUser(db, colleagueId);
    await expect(
      db.query(
        `insert into public.job_seeker_matches
           (organization_id, user_id, job_id, score, breakdown, reasons, gaps, threshold_used, qualified)
         values ($1, $2, $3, 85, $4::jsonb, '[]'::jsonb, '[]'::jsonb, 80, true)`,
        [organizationId, colleagueId, ownerJobId, JSON.stringify(validBreakdown)],
      ),
    ).rejects.toThrow(/foreign key|job_seeker_matches_job_owner_fkey/i);
    await expect(
      db.query(
        `insert into public.job_seeker_applications (organization_id, user_id, job_id, stage)
         values ($1, $2, $3, 'FOUND')`,
        [organizationId, colleagueId, ownerJobId],
      ),
    ).rejects.toThrow(/foreign key|job_seeker_applications_job_owner_fkey/i);
    await reset(db);
  });

  it("keeps the atomic boundary definer-scoped, exact-path, least-privilege, and RLS-forced", async () => {
    const routine = await db.query<{
      security_definer: boolean;
      config: string[] | null;
      authenticated_execute: boolean;
      anon_execute: boolean;
      service_execute: boolean;
      public_execute: boolean;
    }>(
      `select procedure.prosecdef as security_definer,
              procedure.proconfig as config,
              has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute,
              has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
              has_function_privilege('service_role', procedure.oid, 'EXECUTE') as service_execute,
              has_function_privilege('public', procedure.oid, 'EXECUTE') as public_execute
         from pg_proc procedure
         join pg_namespace namespace on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and procedure.proname = 'record_job_seeker_job'`,
    );
    expect(routine.rows).toEqual([
      {
        security_definer: true,
        config: ["search_path=pg_catalog"],
        authenticated_execute: true,
        anon_execute: false,
        service_execute: false,
        public_execute: false,
      },
    ]);

    const rls = await db.query<{ relname: string; enabled: boolean; forced: boolean }>(
      `select relname, relrowsecurity as enabled, relforcerowsecurity as forced
         from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in ('job_seeker_jobs', 'job_seeker_matches', 'job_seeker_applications')
        order by relname`,
    );
    expect(rls.rows).toEqual([
      { relname: "job_seeker_applications", enabled: true, forced: true },
      { relname: "job_seeker_jobs", enabled: true, forced: true },
      { relname: "job_seeker_matches", enabled: true, forced: true },
    ]);
  });
});
