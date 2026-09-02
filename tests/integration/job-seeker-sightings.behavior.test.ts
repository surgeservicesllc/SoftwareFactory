// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postingUrlKey } from "@/lib/job-seeker/board-search/posting-key";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * The posting sightings ledger (ADR-241), proven against the real chain.
 *
 * The properties that matter are the ones a plausible implementation would
 * quietly get wrong: a repeat sighting must count and a re-dated posting
 * must be counted as a repost; a board that states no date must not erase
 * a date an earlier sighting recorded; the JavaScript key must be the exact
 * key the SQL wrote; and no browser role may write the table directly.
 */

const organizationId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";

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

type SightingRow = {
  url_key: string;
  times_seen: number;
  reposts: number;
  earliest_posted_on: string | null;
  latest_posted_on: string | null;
  closes_on: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

async function record(db: PGlite, rows: unknown[]): Promise<number> {
  const result = await db.query<{ recorded: number }>(
    "select public.record_posting_sightings($1::jsonb) as recorded",
    [JSON.stringify(rows)],
  );
  return Number(result.rows[0]!.recorded);
}

async function row(db: PGlite, url: string): Promise<SightingRow | null> {
  // Dates come back as text so the assertions read as the board wrote them.
  const result = await db.query<SightingRow>(
    `select url_key, times_seen, reposts, earliest_posted_on::text, latest_posted_on::text,
            closes_on::text, first_seen_at::text, last_seen_at::text
       from public.read_posting_sightings(array[md5($1)])`,
    [url],
  );
  return result.rows[0] ?? null;
}

const A = "https://boards.example/jobs/a";
const B = "https://boards.example/jobs/b";

describe("posting sightings (ADR-241)", { timeout: 180_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-sightings', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("records what a search returned, one row per URL, readable by every signed-in person", async () => {
    await assumeUser(db, ownerId);
    const recorded = await record(db, [
      { url: A, source: "remotive", company: "Acme", title: "Engineer", postedOn: "2026-08-01", closesOn: "2026-09-30" },
      { url: B, source: "jobicy", company: "Beta", title: "Designer" },
    ]);
    expect(recorded).toBe(2);
    const a = await row(db, A);
    expect(a).toMatchObject({ times_seen: 1, reposts: 0, earliest_posted_on: "2026-08-01", latest_posted_on: "2026-08-01", closes_on: "2026-09-30" });
    expect(await row(db, B)).toMatchObject({ times_seen: 1, earliest_posted_on: null, latest_posted_on: null });
    await reset(db);

    // Public facts: another person in another workspace reads the same row.
    await assumeUser(db, memberId);
    expect(await row(db, A)).toMatchObject({ times_seen: 1 });
    await reset(db);
  });

  it("uses the same key in JavaScript as in SQL", async () => {
    await assumeUser(db, ownerId);
    const result = await db.query<SightingRow>(
      "select * from public.read_posting_sightings($1::text[])",
      [[postingUrlKey(A)]],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.url_key).toBe(postingUrlKey(A));
    await reset(db);
  });

  it("counts repeat sightings, counts a re-dating as a repost, and never lets a missing date erase one", async () => {
    await assumeUser(db, ownerId);
    await record(db, [{ url: A, source: "remotive", company: "Acme", title: "Engineer", postedOn: "2026-08-01" }]);
    let a = await row(db, A);
    expect(a).toMatchObject({ times_seen: 2, reposts: 0 });
    expect(Date.parse(a!.last_seen_at)).toBeGreaterThanOrEqual(Date.parse(a!.first_seen_at));

    // The board moved the date forward: that is a repost, counted.
    await record(db, [{ url: A, source: "remotive", company: "Acme", title: "Engineer", postedOn: "2026-08-20" }]);
    a = await row(db, A);
    expect(a).toMatchObject({ times_seen: 3, reposts: 1, earliest_posted_on: "2026-08-01", latest_posted_on: "2026-08-20" });

    // No date this time: nothing moves, the sighting still counts.
    await record(db, [{ url: A, source: "remotive", company: "Acme", title: "Engineer" }]);
    a = await row(db, A);
    expect(a).toMatchObject({ times_seen: 4, reposts: 1, earliest_posted_on: "2026-08-01", latest_posted_on: "2026-08-20", closes_on: "2026-09-30" });

    // A date earlier than the latest is not a repost, and the earliest stays the earliest.
    await record(db, [{ url: A, source: "remotive", company: "Acme", title: "Engineer", postedOn: "2026-08-10" }]);
    a = await row(db, A);
    expect(a).toMatchObject({ times_seen: 5, reposts: 1, earliest_posted_on: "2026-08-01", latest_posted_on: "2026-08-20" });
    await reset(db);
  });

  it("skips what the schema would refuse and counts only what it wrote", async () => {
    await assumeUser(db, ownerId);
    const recorded = await record(db, [
      { url: "javascript:alert(1)", source: "remotive", company: "X", title: "Y" },
      { url: "https://boards.example/jobs/bad-source", source: "not a key!", company: "X", title: "Y" },
      { url: "https://boards.example/jobs/no-company", source: "remotive", company: "  ", title: "Y" },
      { url: "https://boards.example/jobs/bad-date", source: "remotive", company: "X", title: "Y", postedOn: "2026-02-30" },
      "not an object",
    ]);
    expect(recorded).toBe(1);
    expect(await row(db, "https://boards.example/jobs/bad-source")).toBeNull();
    expect(await row(db, "https://boards.example/jobs/no-company")).toBeNull();
    expect(await row(db, "https://boards.example/jobs/bad-date")).toMatchObject({ times_seen: 1, earliest_posted_on: null });
    await reset(db);
  });

  it("refuses anonymous callers, oversize batches, and every direct write", async () => {
    await db.exec("set role anon");
    await expect(db.query("select public.record_posting_sightings('[]'::jsonb)")).rejects.toThrow(/permission denied/);
    await reset(db);

    await assumeUser(db, ownerId);
    const oversize = Array.from({ length: 401 }, (_, index) => ({
      url: `https://boards.example/jobs/many-${index}`, source: "remotive", company: "C", title: "T",
    }));
    await expect(record(db, oversize)).rejects.toThrow(/at most 400 sightings/);
    await expect(db.query(
      "insert into public.job_seeker_posting_sightings (url_key, url, source, company, title) values (md5('https://x/y'), 'https://x/y', 'remotive', 'C', 'T')",
    )).rejects.toThrow(/permission denied/);
    await expect(db.query("update public.job_seeker_posting_sightings set times_seen = 99")).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.job_seeker_posting_sightings")).rejects.toThrow(/permission denied/);
    await reset(db);

    // service_role holds no grant on the table: the pinned grants contract.
    await db.exec("set role service_role");
    await expect(db.query("select count(*) from public.job_seeker_posting_sightings")).rejects.toThrow(/permission denied/);
    await reset(db);

    const flags = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'job_seeker_posting_sightings'",
    );
    expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("reads exact keys only and answers nothing to a request over the bound", async () => {
    await assumeUser(db, ownerId);
    const exact = await db.query<SightingRow>(
      "select * from public.read_posting_sightings($1::text[])",
      [[postingUrlKey(A), postingUrlKey("https://boards.example/jobs/never-seen")]],
    );
    expect(exact.rows.map((r) => r.url_key)).toEqual([postingUrlKey(A)]);
    const tooMany = await db.query<SightingRow>(
      "select * from public.read_posting_sightings($1::text[])",
      [Array.from({ length: 1001 }, (_, index) => postingUrlKey(index === 0 ? A : `https://x/${index}`))],
    );
    expect(tooMany.rows).toHaveLength(0);
    await reset(db);
  });
});
