// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { JOB_SEEKER_WEIGHTS, scoreJob } from "@/lib/job-seeker/scoring";

/**
 * The Job Seeker foundation, proven against the real migrated chain.
 *
 * Three invariants live in the schema on purpose — the approval gate, the
 * duplicate key, and score integrity — because application code is
 * replaceable and these must not be. Each is exercised here as the database
 * sees it: through RLS as the authenticated owner, with a second member
 * proving the privacy boundary (career data is personal even inside a
 * tenant).
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

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

describe("job seeker foundation", { timeout: 180_000 }, () => {
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
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-job-seeker', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("stores a career profile for its owner, invisible to other members", async () => {
    await assumeUser(db, ownerId);
    await db.query(
      `insert into public.job_seeker_profiles
         (organization_id, user_id, full_name, skills, employment_history)
       values ($1, $2, 'Daniel H', '["TypeScript","Postgres"]'::jsonb,
         '[{"organization":"Surge Services","title":"Founder","started":"2020","highlights":["Built the factory"]}]'::jsonb)`,
      [organizationId, ownerId],
    );
    const own = await db.query<{ full_name: string }>(
      "select full_name from public.job_seeker_profiles where organization_id = $1",
      [organizationId],
    );
    expect(own.rows).toHaveLength(1);
    await reset(db);

    // Another member of the SAME organization sees nothing: career data is
    // personal, not tenant-shared.
    await assumeUser(db, memberId);
    const other = await db.query(
      "select id from public.job_seeker_profiles where organization_id = $1",
      [organizationId],
    );
    expect(other.rows).toHaveLength(0);
    // And cannot write a row attributed to someone else.
    await expect(
      db.query(
        "insert into public.job_seeker_profiles (organization_id, user_id) values ($1, $2)",
        [organizationId, ownerId],
      ),
    ).rejects.toThrow();
    await reset(db);
  });

  it("refuses malformed profile shapes at the schema", async () => {
    await assumeUser(db, ownerId);
    // A history entry with an unknown key is refused, not stored loosely.
    await expect(
      db.query(
        `update public.job_seeker_profiles
           set employment_history = '[{"organization":"X","title":"Y","salaryGuess":"200k"}]'::jsonb
         where organization_id = $1 and user_id = $2`,
        [organizationId, ownerId],
      ),
    ).rejects.toThrow();
    // A skills list of objects is refused.
    await expect(
      db.query(
        `update public.job_seeker_profiles set skills = '[{"name":"TS"}]'::jsonb
         where organization_id = $1 and user_id = $2`,
        [organizationId, ownerId],
      ),
    ).rejects.toThrow();
    await reset(db);
  });

  it("keeps one job per company+title+external id and scores it auditable", async () => {
    await assumeUser(db, ownerId);
    const job = await db.query<{ id: string }>(
      `insert into public.job_seeker_jobs
         (organization_id, user_id, title, company, external_id, url)
       values ($1, $2, 'Staff Engineer', 'Acme Corp', 'acme-123', 'https://jobs.acme.example/123')
       returning id`,
      [organizationId, ownerId],
    );
    const jobId = job.rows[0].id;

    // The duplicate: same company and title with case/whitespace noise.
    await expect(
      db.query(
        `insert into public.job_seeker_jobs
           (organization_id, user_id, title, company, external_id)
         values ($1, $2, '  staff engineer ', 'ACME CORP', 'acme-123')`,
        [organizationId, ownerId],
      ),
    ).rejects.toThrow(/duplicate key/);

    // The engine's score is what the schema accepts: components bounded by
    // the published weights, total equal to the sum, qualified derived.
    const scored = scoreJob({
      breakdown: {
        experience: 28, skills: 18, leadership: 12, industry: 8,
        compensation: 9, location: 10, career_growth: 4,
      },
      threshold: 80,
      reasons: ["Deep TypeScript history"],
      gaps: ["No stated leadership scope"],
    });
    await db.query(
      `insert into public.job_seeker_matches
         (organization_id, user_id, job_id, score, breakdown, reasons, gaps, threshold_used, qualified)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)`,
      [organizationId, ownerId, jobId, scored.score, JSON.stringify(scored.breakdown),
        JSON.stringify(scored.reasons), JSON.stringify(scored.gaps), scored.threshold, scored.qualified],
    );

    // A component above its weight is refused.
    await expect(
      db.query(
        `insert into public.job_seeker_matches
           (organization_id, user_id, job_id, score, breakdown, threshold_used, qualified)
         values ($1, $2, $3, 100,
           '{"experience":35,"skills":20,"leadership":15,"industry":10,"compensation":10,"location":5,"career_growth":5}'::jsonb,
           80, true)`,
        [organizationId, ownerId, jobId],
      ),
    ).rejects.toThrow();
    // A total that is not the sum of its parts is refused.
    await expect(
      db.query(
        `insert into public.job_seeker_matches
           (organization_id, user_id, job_id, score, breakdown, threshold_used, qualified)
         values ($1, $2, $3, 99,
           '{"experience":10,"skills":10,"leadership":10,"industry":5,"compensation":5,"location":5,"career_growth":5}'::jsonb,
           80, true)`,
        [organizationId, ownerId, jobId],
      ),
    ).rejects.toThrow();
    await reset(db);
  });

  it("holds the approval gate in the schema, not the client", async () => {
    await assumeUser(db, ownerId);
    const job = await db.query<{ id: string }>(
      `insert into public.job_seeker_jobs (organization_id, user_id, title, company)
       values ($1, $2, 'Platform Lead', 'Beta Industries') returning id`,
      [organizationId, ownerId],
    );
    const application = await db.query<{ id: string }>(
      `insert into public.job_seeker_applications (organization_id, user_id, job_id, stage)
       values ($1, $2, $3, 'READY_FOR_REVIEW') returning id`,
      [organizationId, ownerId, job.rows[0].id],
    );
    const applicationId = application.rows[0].id;

    // Moving to APPLIED without an approval is a CHECK violation.
    await expect(
      db.query(
        "update public.job_seeker_applications set stage = 'APPLIED' where id = $1",
        [applicationId],
      ),
    ).rejects.toThrow();
    // Approving without the decision evidence is refused too.
    await expect(
      db.query(
        "update public.job_seeker_applications set approval_status = 'approved' where id = $1",
        [applicationId],
      ),
    ).rejects.toThrow();

    // The real path: an explicit decision, then the stage.
    await db.query(
      `update public.job_seeker_applications
         set approval_status = 'approved', decided_at = now(), decided_by = $2
       where id = $1`,
      [applicationId, ownerId],
    );
    await db.query(
      "update public.job_seeker_applications set stage = 'APPLIED', applied_at = now() where id = $1",
      [applicationId],
    );
    const state = await db.query<{ stage: string }>(
      "select stage::text as stage from public.job_seeker_applications where id = $1",
      [applicationId],
    );
    expect(state.rows[0].stage).toBe("APPLIED");

    // A rejected application can still be CLOSED — the gate exempts closure.
    const secondJob = await db.query<{ id: string }>(
      `insert into public.job_seeker_jobs (organization_id, user_id, title, company)
       values ($1, $2, 'Head of Data', 'Gamma LLC') returning id`,
      [organizationId, ownerId],
    );
    const rejected = await db.query<{ id: string }>(
      `insert into public.job_seeker_applications
         (organization_id, user_id, job_id, stage, approval_status, decided_at, decided_by)
       values ($1, $2, $3, 'READY_FOR_REVIEW', 'rejected', now(), $4) returning id`,
      [organizationId, ownerId, secondJob.rows[0].id, ownerId],
    );
    await db.query(
      "update public.job_seeker_applications set stage = 'CLOSED' where id = $1",
      [rejected.rows[0].id],
    );
    await reset(db);
  });

  it("versions generated documents immutably and keeps outreach sends honest", async () => {
    await assumeUser(db, ownerId);
    const applicationId = (await db.query<{ id: string }>(
      "select id from public.job_seeker_applications where stage = 'APPLIED' limit 1",
    )).rows[0].id;

    await db.query(
      `insert into public.job_seeker_documents (organization_id, user_id, application_id, kind, version, content)
       values ($1, $2, $3, 'resume', 1, 'Resume v1 from verified profile facts.')`,
      [organizationId, ownerId, applicationId],
    );
    // Same version twice: refused. A new version: stored.
    await expect(
      db.query(
        `insert into public.job_seeker_documents (organization_id, user_id, application_id, kind, version, content)
         values ($1, $2, $3, 'resume', 1, 'Overwrite attempt')`,
        [organizationId, ownerId, applicationId],
      ),
    ).rejects.toThrow(/duplicate key/);
    // Rewriting a stored version: refused by the append-only trigger.
    await expect(
      db.query("update public.job_seeker_documents set content = 'rewritten'"),
    ).rejects.toThrow(/append-only/);

    // Outreach cannot claim 'sent' without a sent_at — and nothing sets
    // sent_at yet, because no send integration exists.
    const contact = await db.query<{ id: string }>(
      `insert into public.job_seeker_contacts (organization_id, user_id, application_id, name, role)
       values ($1, $2, $3, 'Riley Recruiter', 'Technical Recruiter') returning id`,
      [organizationId, ownerId, applicationId],
    );
    await expect(
      db.query(
        `insert into public.job_seeker_outreach (organization_id, user_id, contact_id, body, status)
         values ($1, $2, $3, 'Hello — I applied to the Platform Lead role.', 'sent')`,
        [organizationId, ownerId, contact.rows[0].id],
      ),
    ).rejects.toThrow();
    await db.query(
      `insert into public.job_seeker_outreach (organization_id, user_id, contact_id, body, status)
       values ($1, $2, $3, 'Hello — I applied to the Platform Lead role.', 'draft')`,
      [organizationId, ownerId, contact.rows[0].id],
    );
    await reset(db);
  });

  it("keeps the engine weights and the schema weights identical", async () => {
    // lib/job-seeker/scoring.ts and job_seeker_breakdown_valid both state the
    // published weights. This pins them to each other through behavior: a
    // full-weight breakdown from the engine constants must be exactly the
    // schema's maximum acceptable score.
    const full = Object.fromEntries(
      Object.entries(JOB_SEEKER_WEIGHTS).map(([key, weight]) => [key, weight]),
    );
    const total = Object.values(JOB_SEEKER_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(100);

    await assumeUser(db, ownerId);
    const job = await db.query<{ id: string }>(
      `insert into public.job_seeker_jobs (organization_id, user_id, title, company)
       values ($1, $2, 'Perfect Fit Role', 'Delta Co') returning id`,
      [organizationId, ownerId],
    );
    await db.query(
      `insert into public.job_seeker_matches
         (organization_id, user_id, job_id, score, breakdown, threshold_used, qualified)
       values ($1, $2, $3, $4, $5::jsonb, 80, true)`,
      [organizationId, ownerId, job.rows[0].id, total, JSON.stringify(full)],
    );
    await reset(db);
  });
});
