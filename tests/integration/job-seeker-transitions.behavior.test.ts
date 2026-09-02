// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedDatabase } from "../support/migrated-database";

/**
 * The application transitions ledger (ADR-243), proven against the chain.
 *
 * The trigger must write every stage and approval change and nothing else;
 * the ledger must be append-only and private to its owner; a closure reason
 * must be refused off a CLOSED row; and the two functions must count a
 * rejection as a reply, a silent application as silent, and a median from
 * real timestamps.
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

type Transition = { from_stage: string | null; to_stage: string; from_approval: string | null; to_approval: string; closed_reason: string | null };

async function transitions(db: PGlite, applicationId: string): Promise<Transition[]> {
  const result = await db.query<Transition>(
    `select from_stage::text, to_stage::text, from_approval::text, to_approval::text, closed_reason::text
       from public.job_seeker_application_transitions where application_id = $1 order by occurred_at, id`,
    [applicationId],
  );
  return result.rows;
}

describe("application transitions (ADR-243)", { timeout: 180_000 }, () => {
  let db: PGlite;
  let silentId = "";
  let repliedId = "";
  let rejectedId = "";

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-transitions', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  async function recordApplication(source: string, title: string): Promise<string> {
    const job = await db.query<{ id: string }>(
      `insert into public.job_seeker_jobs (organization_id, user_id, source, title, company)
       values ($1, $2, $3, $4, 'Acme') returning id`,
      [organizationId, ownerId, source, title],
    );
    const application = await db.query<{ id: string }>(
      `insert into public.job_seeker_applications (organization_id, user_id, job_id, stage)
       values ($1, $2, $3, 'FOUND') returning id`,
      [organizationId, ownerId, job.rows[0]!.id],
    );
    return application.rows[0]!.id;
  }

  it("writes one row per stage or approval change, and none for an unrelated edit", async () => {
    await assumeUser(db, ownerId);
    silentId = await recordApplication("remotive", "Silent Role");
    expect(await transitions(db, silentId)).toEqual([
      { from_stage: null, to_stage: "FOUND", from_approval: null, to_approval: "pending_review", closed_reason: null },
    ]);
    await db.query("update public.job_seeker_applications set notes = 'a note' where id = $1", [silentId]);
    expect(await transitions(db, silentId)).toHaveLength(1);
    await db.query("update public.job_seeker_applications set stage = 'READY_FOR_REVIEW' where id = $1", [silentId]);
    await db.query(
      "update public.job_seeker_applications set approval_status = 'approved', decided_at = now(), decided_by = $2 where id = $1",
      [silentId, ownerId],
    );
    await db.query(
      "update public.job_seeker_applications set stage = 'APPLIED', applied_at = now() - interval '10 days' where id = $1",
      [silentId],
    );
    const rows = await transitions(db, silentId);
    expect(rows.map((row) => [row.from_stage, row.to_stage, row.to_approval])).toEqual([
      [null, "FOUND", "pending_review"],
      ["FOUND", "READY_FOR_REVIEW", "pending_review"],
      ["READY_FOR_REVIEW", "READY_FOR_REVIEW", "approved"],
      ["READY_FOR_REVIEW", "APPLIED", "approved"],
    ]);
    await reset(db);
  });

  it("counts a recruiter response and a rejection as replies, and measures the median from real timestamps", async () => {
    await assumeUser(db, ownerId);
    repliedId = await recordApplication("remotive", "Replied Role");
    await db.query("update public.job_seeker_applications set stage = 'READY_FOR_REVIEW' where id = $1", [repliedId]);
    await db.query(
      "update public.job_seeker_applications set approval_status = 'approved', decided_at = now(), decided_by = $2 where id = $1",
      [repliedId, ownerId],
    );
    await db.query(
      "update public.job_seeker_applications set stage = 'APPLIED', applied_at = now() - interval '8 days' where id = $1",
      [repliedId],
    );
    await db.query("update public.job_seeker_applications set stage = 'RECRUITER_RESPONSE' where id = $1", [repliedId]);

    rejectedId = await recordApplication("manual", "Rejected Role");
    await db.query("update public.job_seeker_applications set stage = 'READY_FOR_REVIEW' where id = $1", [rejectedId]);
    await db.query(
      "update public.job_seeker_applications set approval_status = 'approved', decided_at = now(), decided_by = $2 where id = $1",
      [rejectedId, ownerId],
    );
    await db.query(
      "update public.job_seeker_applications set stage = 'APPLIED', applied_at = now() - interval '4 days' where id = $1",
      [rejectedId],
    );
    await db.query(
      "update public.job_seeker_applications set stage = 'CLOSED', closed_reason = 'rejected_before_interview' where id = $1",
      [rejectedId],
    );

    const replies = await db.query<{ application_id: string; days: number }>(
      `select application_id, round(extract(epoch from (replied_at - now())) / 86400.0)::integer as days
         from public.job_seeker_application_replies($1) order by application_id`,
      [organizationId],
    );
    expect(replies.rows.map((row) => row.application_id).sort()).toEqual([repliedId, rejectedId].sort());

    const stats = await db.query<{ source: string | null; applied: number; replied: number; silent: number; median_days_to_reply: string | null }>(
      "select source, applied, replied, silent, median_days_to_reply::text from public.job_seeker_response_stats($1)",
      [organizationId],
    );
    const all = stats.rows.find((row) => row.source === null)!;
    expect(all).toMatchObject({ applied: 3, replied: 2, silent: 1 });
    // Replies came 8 and 4 days after applying; the median of two is their mean.
    expect(Number(all.median_days_to_reply)).toBeCloseTo(6, 0);
    const remotive = stats.rows.find((row) => row.source === "remotive")!;
    expect(remotive).toMatchObject({ applied: 2, replied: 1, silent: 1 });
    expect(Number(remotive.median_days_to_reply)).toBeCloseTo(8, 0);
    await reset(db);
  });

  it("allows a closure reason only on a closed application", async () => {
    await assumeUser(db, ownerId);
    await expect(db.query(
      "update public.job_seeker_applications set closed_reason = 'withdrew' where id = $1",
      [silentId],
    )).rejects.toThrow(/closed_reason_only_when_closed/);
    await reset(db);
  });

  it("is append-only and private to its owner, with no service_role grant", async () => {
    await assumeUser(db, ownerId);
    // Two guards stand in the way of a rewrite — no UPDATE/DELETE grant,
    // and the append-only trigger behind it — and either refusal is the
    // right answer; the trigger is what catches a role that does hold the
    // grant, which the definer recorder is the only one of.
    await expect(db.query("update public.job_seeker_application_transitions set to_stage = 'OFFER'")).rejects.toThrow(/append-only|permission denied/);
    await expect(db.query("delete from public.job_seeker_application_transitions")).rejects.toThrow(/append-only|permission denied/);
    await reset(db);
    await expect(db.query("update public.job_seeker_application_transitions set to_stage = 'OFFER'")).rejects.toThrow(/append-only/);
    await assumeUser(db, ownerId);
    await expect(db.query(
      `insert into public.job_seeker_application_transitions (organization_id, user_id, application_id, to_stage, to_approval)
       values ($1, $2, $3, 'OFFER', 'approved')`,
      [organizationId, ownerId, silentId],
    )).rejects.toThrow(/permission denied/);
    await reset(db);

    await assumeUser(db, memberId);
    const other = await db.query("select id from public.job_seeker_application_transitions");
    expect(other.rows).toHaveLength(0);
    const otherStats = await db.query<{ applied: number }>("select applied from public.job_seeker_response_stats($1)", [organizationId]);
    expect(otherStats.rows).toHaveLength(0);
    await reset(db);

    await db.exec("set role anon");
    await expect(db.query("select * from public.job_seeker_response_stats($1)", [organizationId])).rejects.toThrow(/permission denied/);
    await reset(db);

    await db.exec("set role service_role");
    await expect(db.query("select count(*) from public.job_seeker_application_transitions")).rejects.toThrow(/permission denied/);
    await reset(db);

    const flags = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'job_seeker_application_transitions'",
    );
    expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
