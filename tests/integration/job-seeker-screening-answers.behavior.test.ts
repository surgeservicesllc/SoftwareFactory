// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedDatabase } from "../support/migrated-database";

/**
 * The screening answers table (ADR-244): a fixed vocabulary, one answer per
 * question, the person's own rows and nobody else's.
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

describe("screening answers (ADR-244)", { timeout: 180_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-screening', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("keeps one answer per question from the fixed vocabulary, upserted in place", async () => {
    await assumeUser(db, ownerId);
    await db.query(
      `insert into public.job_seeker_screening_answers (organization_id, user_id, question_key, answer)
       values ($1, $2, 'needs_sponsorship', 'No')`,
      [organizationId, ownerId],
    );
    await expect(db.query(
      `insert into public.job_seeker_screening_answers (organization_id, user_id, question_key, answer)
       values ($1, $2, 'shoe_size', '42')`,
      [organizationId, ownerId],
    )).rejects.toThrow(/question_key_check/);
    await expect(db.query(
      `insert into public.job_seeker_screening_answers (organization_id, user_id, question_key, answer)
       values ($1, $2, 'notice_period', '   ')`,
      [organizationId, ownerId],
    )).rejects.toThrow(/answer_check/);
    await db.query(
      `insert into public.job_seeker_screening_answers (organization_id, user_id, question_key, answer)
       values ($1, $2, 'needs_sponsorship', 'Yes, H-1B transfer')
       on conflict (organization_id, user_id, question_key) do update set answer = excluded.answer, updated_at = now()`,
      [organizationId, ownerId],
    );
    const rows = await db.query<{ answer: string }>(
      "select answer from public.job_seeker_screening_answers where question_key = 'needs_sponsorship'",
    );
    expect(rows.rows).toEqual([{ answer: "Yes, H-1B transfer" }]);
    await reset(db);
  });

  it("is private to its owner, with no service_role grant and RLS forced", async () => {
    await assumeUser(db, memberId);
    expect((await db.query("select id from public.job_seeker_screening_answers")).rows).toHaveLength(0);
    await expect(db.query(
      `insert into public.job_seeker_screening_answers (organization_id, user_id, question_key, answer)
       values ($1, $2, 'references', 'Yes')`,
      [organizationId, ownerId],
    )).rejects.toThrow(/row-level security/);
    await reset(db);

    await db.exec("set role service_role");
    await expect(db.query("select count(*) from public.job_seeker_screening_answers")).rejects.toThrow(/permission denied/);
    await reset(db);

    const flags = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'job_seeker_screening_answers'",
    );
    expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
