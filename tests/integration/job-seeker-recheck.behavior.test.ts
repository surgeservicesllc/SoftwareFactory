// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postingUrlKey } from "@/lib/job-seeker/board-search/posting-key";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * The recheck on the sightings row (ADR-249), proven against the real
 * chain: recorded once through the definer function, reused under ten
 * minutes, refused outside the vocabulary, silent for an unknown key,
 * and readable with the sighting by every signed-in person.
 */

const ownerId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const url = "https://boards.example.com/jobs/recheck-1";

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

describe("posting recheck (ADR-249)", { timeout: 180_000 }, () => {
  let db: PGlite;
  const key = postingUrlKey(url);

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-recheck', '${ownerId}');
    `);
    await assumeUser(db, ownerId);
    await db.query(`select public.record_posting_sightings($1::jsonb)`, [
      JSON.stringify([{ url, source: "jobnet", company: "Acme", title: "Engineer", postedOn: "2026-08-01", closesOn: null }]),
    ]);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("records the outcome on the existing row and answers it with the sighting", async () => {
    await assumeUser(db, ownerId);
    const recorded = await db.query<{ last_check_status: string; last_check_http_status: number; checks: number }>(
      `select last_check_status, last_check_http_status, checks from public.record_posting_recheck($1, 'gone', 404, 'HTTP 404 — the page is gone.')`,
      [key],
    );
    expect(recorded.rows[0]).toEqual({ last_check_status: "gone", last_check_http_status: 404, checks: 1 });
    const read = await db.query<{ last_check_status: string; last_check_note: string; times_seen: number }>(
      `select last_check_status, last_check_note, times_seen from public.read_posting_sightings($1::text[])`,
      [[key]],
    );
    expect(read.rows[0]).toEqual({ last_check_status: "gone", last_check_note: "HTTP 404 — the page is gone.", times_seen: 1 });
  });

  it("reuses a check under ten minutes old instead of rewriting it", async () => {
    await assumeUser(db, ownerId);
    const again = await db.query<{ last_check_status: string; checks: number }>(
      `select last_check_status, checks from public.record_posting_recheck($1, 'open', 200, 'HTTP 200 — the page is up.')`,
      [key],
    );
    expect(again.rows[0]).toEqual({ last_check_status: "gone", checks: 1 });
    await reset(db);
    await db.query(`update public.job_seeker_posting_sightings set last_checked_at = now() - interval '11 minutes' where url_key = $1`, [key]);
    await assumeUser(db, ownerId);
    const later = await db.query<{ last_check_status: string; checks: number }>(
      `select last_check_status, checks from public.record_posting_recheck($1, 'open', 200, 'HTTP 200 — the page is up.')`,
      [key],
    );
    expect(later.rows[0]).toEqual({ last_check_status: "open", checks: 2 });
  });

  it("refuses a status outside the vocabulary, a bad key, an empty note, and answers nothing for an unknown key", async () => {
    await assumeUser(db, ownerId);
    await expect(db.query(`select * from public.record_posting_recheck($1, 'maybe', 200, 'x')`, [key])).rejects.toThrow(/unknown recheck status/);
    await expect(db.query(`select * from public.record_posting_recheck('nope', 'open', 200, 'x')`)).rejects.toThrow(/32 hex/);
    await expect(db.query(`select * from public.record_posting_recheck($1, 'open', 200, '')`, [key])).rejects.toThrow(/1 to 200/);
    const unknown = await db.query(`select * from public.record_posting_recheck($1, 'open', 200, 'x')`, ["0".repeat(32)]);
    expect(unknown.rows).toHaveLength(0);
  });

  it("refuses anonymous callers and every direct write", async () => {
    await reset(db);
    await db.exec(`set role anon;`);
    await expect(db.query(`select * from public.record_posting_recheck($1, 'open', 200, 'x')`, [key])).rejects.toThrow(/permission denied|authentication is required/);
    await reset(db);
    await assumeUser(db, ownerId);
    await expect(db.query(`update public.job_seeker_posting_sightings set last_check_status = 'open' where url_key = $1`, [key])).rejects.toThrow(/permission denied/);
  });
});
