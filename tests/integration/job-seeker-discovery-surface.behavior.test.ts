// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase, latestMigration } from "../support/migrated-database";
import { LATEST_MIGRATION } from "../support/latest-migration";

const seekerId = "00000000-0000-4000-8000-00000000d501";
const outsiderId = "00000000-0000-4000-8000-00000000d502";
const organizationId = "10000000-0000-4000-8000-00000000d501";
const jobId = "20000000-0000-4000-8000-00000000d501";

let db: PGlite;

async function actAs(userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function asAnon() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role anon");
}

/**
 * The Job Discovery surface, against the real migrated schema.
 *
 * The page shows a bookmark, an alert count and a credit meter. Each is backed
 * by a table added here, and each carries the same boundary the rest of Job
 * Seeker has: the owner reads their own rows, an unrelated member of no
 * organization reads nothing, and anon reads nothing at all. A new table that
 * quietly relaxes that is a hole in an otherwise uniform boundary, which is
 * why the denial cases are asserted rather than assumed from the policy text.
 *
 * The credit meter's honesty rests on the event log being append-only, so that
 * is exercised too: a meter over a rewritable log would report whatever the
 * last writer preferred.
 */
describe("the job discovery surface", () => {
  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed.
    expect(await latestMigration()).toBe(LATEST_MIGRATION);
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${seekerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Seeker Tenant', 'seeker-tenant', '${seekerId}');
      insert into public.job_seeker_jobs
        (id, organization_id, user_id, source, title, company, location, discovered_at)
      values
        ('${jobId}', '${organizationId}', '${seekerId}', 'greenhouse',
         'VP of Marketing', 'Adobe', 'Remote (US)', now());
    `);
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("defaults a posting to unsaved, and records when it was saved", async () => {
    await actAs(seekerId);
    const before = await db.query<{ saved_at: string | null }>(
      `select saved_at from public.job_seeker_jobs where id = $1::uuid`, [jobId],
    );
    expect(before.rows[0]?.saved_at).toBeNull();

    await db.query(
      `update public.job_seeker_jobs set saved_at = now() where id = $1::uuid`, [jobId],
    );
    const after = await db.query<{ saved_at: string | null }>(
      `select saved_at from public.job_seeker_jobs where id = $1::uuid`, [jobId],
    );
    expect(after.rows[0]?.saved_at).not.toBeNull();
  });

  it("gives every seeker a weekly allowance the meter can be measured against", async () => {
    await actAs(seekerId);
    await db.query(
      `insert into public.job_seeker_preferences (organization_id, user_id) values ($1::uuid, $2::uuid)`,
      [organizationId, seekerId],
    );
    const { rows } = await db.query<{ weekly_search_allowance: number; qualification_threshold: number }>(
      `select weekly_search_allowance, qualification_threshold
         from public.job_seeker_preferences where user_id = $1::uuid`,
      [seekerId],
    );
    // 2000 is the design's ceiling and 80 its "High Match" bar. Both are rows,
    // so a workspace can change either without a deploy.
    expect(rows[0]?.weekly_search_allowance).toBe(2000);
    expect(rows[0]?.qualification_threshold).toBe(80);
  });

  it("records a search event that the meter can count", async () => {
    await actAs(seekerId);
    await db.query(
      `insert into public.job_seeker_search_events (organization_id, user_id, board, query, results_returned)
       values ($1::uuid, $2::uuid, 'greenhouse', '{"text":"marketing"}'::jsonb, 12)`,
      [organizationId, seekerId],
    );
    const { rows } = await db.query<{ total: number }>(
      `select count(*)::int as total from public.job_seeker_search_events
        where user_id = $1::uuid and created_at >= now() - interval '7 days'`,
      [seekerId],
    );
    expect(rows[0]?.total).toBe(1);
  });

  it("refuses to let a search event be rewritten or deleted", async () => {
    // The meter counts what happened. A rewritable log would let it report
    // whatever the last writer preferred.
    await actAs(seekerId);
    await expect(db.query(
      `update public.job_seeker_search_events set results_returned = 0 where user_id = $1::uuid`,
      [seekerId],
    )).rejects.toThrow(/append-only/);
    await expect(db.query(
      `delete from public.job_seeker_search_events where user_id = $1::uuid`,
      [seekerId],
    )).rejects.toThrow(/append-only/);
  });

  it("links an alert to the saved search it came from", async () => {
    await actAs(seekerId);
    const search = await db.query<{ id: string }>(
      `insert into public.job_seeker_saved_searches (organization_id, user_id, name, query)
       values ($1::uuid, $2::uuid, 'Remote VP Marketing', '{"text":"vp marketing"}'::jsonb)
       returning id`,
      [organizationId, seekerId],
    );
    const searchId = search.rows[0].id;
    await db.query(
      `insert into public.job_seeker_search_alerts (organization_id, user_id, saved_search_id)
       values ($1::uuid, $2::uuid, $3::uuid)`,
      [organizationId, seekerId, searchId],
    );
    const { rows } = await db.query<{ total: number }>(
      `select count(*)::int as total from public.job_seeker_search_alerts
        where user_id = $1::uuid and active`,
      [seekerId],
    );
    expect(rows[0]?.total).toBe(1);
  });

  it("deletes an alert when its saved search goes, never orphaning it", async () => {
    await actAs(seekerId);
    await db.query(`delete from public.job_seeker_saved_searches where user_id = $1::uuid`, [seekerId]);
    const { rows } = await db.query<{ total: number }>(
      `select count(*)::int as total from public.job_seeker_search_alerts where user_id = $1::uuid`,
      [seekerId],
    );
    expect(rows[0]?.total).toBe(0);
  });

  it("shows an unrelated user none of the seeker's rows", async () => {
    await actAs(outsiderId);
    for (const table of ["job_seeker_saved_searches", "job_seeker_search_alerts", "job_seeker_search_events"]) {
      const { rows } = await db.query<{ total: number }>(
        `select count(*)::int as total from public.${table}`,
      );
      expect(rows[0]?.total, `${table} leaked to an unrelated user`).toBe(0);
    }
  });

  it("refuses an unrelated user's write into the seeker's workspace", async () => {
    await actAs(outsiderId);
    await expect(db.query(
      `insert into public.job_seeker_search_events (organization_id, user_id, board)
       values ($1::uuid, $2::uuid, 'greenhouse')`,
      [organizationId, outsiderId],
    )).rejects.toThrow();
  });

  it("shows anonymous nothing at all", async () => {
    await asAnon();
    for (const table of ["job_seeker_saved_searches", "job_seeker_search_alerts", "job_seeker_search_events"]) {
      await expect(
        db.query(`select count(*) from public.${table}`),
        `${table} was readable anonymously`,
      ).rejects.toThrow();
    }
  });
});
