// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The review table, against real PostgreSQL.
 *
 * PGlite runs as a superuser and bypasses row level security, so it is the
 * wrong tool for proving a policy holds and the right one for what a policy
 * cannot express: that the CHECKs refuse the rows they exist to refuse. Every
 * one of them encodes a claim that would otherwise be possible to store
 * falsely — a critique attributed to a model that never ran, an "applied"
 * timestamp with nothing applied, more edits accounted for than proposed.
 * The RLS assertions read pg_class, which a superuser cannot make lie.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000c001";
const otherId = "00000000-0000-4000-8000-00000000c002";
const organizationId = "10000000-0000-4000-8000-00000000c001";

let db: PGlite;
let documentId: string;

type ReviewRow = Record<string, unknown>;

async function insertReview(overrides: ReviewRow = {}): Promise<string> {
  const row: ReviewRow = {
    status: "reviewed",
    model: "claude-test-model",
    detail: "Reviewed by claude-test-model.",
    edits: [{ find: "Owned the API.", replace: "Owned API design.", reason: "tighter" }],
    narrative: [{ category: "tone", note: "Strong opening." }],
    applied_at: null,
    applied_edit_count: 0,
    rejected_edit_count: 0,
    ...overrides,
  };
  const result = await db.query<{ id: string }>(
    `insert into public.job_seeker_document_reviews
       (organization_id, user_id, document_id, status, model, detail, edits, narrative,
        applied_at, applied_edit_count, rejected_edit_count)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      organizationId, ownerId, documentId,
      row.status, row.model, row.detail,
      JSON.stringify(row.edits), JSON.stringify(row.narrative),
      row.applied_at, row.applied_edit_count, row.rejected_edit_count,
    ],
  );
  return result.rows[0].id;
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid()
    returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create or replace function auth.jwt()
    returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  for (const file of (await readdir(migrationsRoot)).filter((n) => /^\d+.*\.sql$/.test(n)).sort()) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }

  await db.exec(`
    insert into auth.users (id) values ('${ownerId}'), ('${otherId}');
    insert into public.organizations (id, name, slug, created_by) values
      ('${organizationId}', 'Reviewer Co', 'reviewer-co', '${ownerId}');
  `);
  for (const [userId, role] of [[ownerId, "owner"], [otherId, "member"]] as const) {
    await db.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, $3) on conflict (organization_id, user_id) do update set role = $3`,
      [organizationId, userId, role],
    );
  }

  const job = await db.query<{ id: string }>(
    `insert into public.job_seeker_jobs (organization_id, user_id, title, company)
     values ($1, $2, 'Platform Engineer', 'Hyperbound') returning id`,
    [organizationId, ownerId],
  );
  const application = await db.query<{ id: string }>(
    `insert into public.job_seeker_applications (organization_id, user_id, job_id)
     values ($1, $2, $3) returning id`,
    [organizationId, ownerId, job.rows[0].id],
  );
  const document = await db.query<{ id: string }>(
    `insert into public.job_seeker_documents
       (organization_id, user_id, application_id, kind, version, content)
     values ($1, $2, $3, 'resume', 1, 'Owned the API.') returning id`,
    [organizationId, ownerId, application.rows[0].id],
  );
  documentId = document.rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the review table", () => {
  it("is protected the same way every other job_seeker table is", async () => {
    const result = await db.query<{
      rls: boolean; forced: boolean; policies: number; anon_select: boolean;
    }>(`
      select relation.relrowsecurity as rls,
             relation.relforcerowsecurity as forced,
             (select count(*)::int from pg_policy where polrelid = relation.oid) as policies,
             has_table_privilege('anon', relation.oid, 'SELECT') as anon_select
        from pg_class relation
        join pg_namespace space on space.oid = relation.relnamespace
       where space.nspname = 'public' and relation.relname = 'job_seeker_document_reviews'
    `);
    const [row] = result.rows;
    expect(row.rls).toBe(true);
    expect(row.forced).toBe(true);
    // select, insert, update, delete — one policy each.
    expect(row.policies).toBe(4);
    expect(row.anon_select).toBe(false);
  });

  it("stores a real review", async () => {
    await expect(insertReview()).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a review attributed to a model that never ran", async () => {
    // The false claim the status column exists to prevent.
    await expect(insertReview({ status: "reviewed", model: null })).rejects.toThrow(
      /job_seeker_document_review_reviewed_names_model/,
    );
    await expect(insertReview({ status: "unavailable", model: "claude-test-model", edits: [], narrative: [] }))
      .rejects.toThrow(/job_seeker_document_review_reviewed_names_model/);
  });

  it("refuses a critique on a review that reports itself unavailable", async () => {
    // "No provider was reachable" and "here is what the model said" cannot
    // both be true of one row.
    await expect(insertReview({
      status: "unavailable", model: null, detail: "No provider configured.",
      edits: [{ find: "a", replace: "b", reason: "c" }], narrative: [],
    })).rejects.toThrow(/job_seeker_document_review_unavailable_is_empty/);
  });

  it("accepts an unavailable review that says nothing", async () => {
    await expect(insertReview({
      status: "unavailable", model: null, detail: "No model provider is configured on this server.",
      edits: [], narrative: [],
    })).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses an applied timestamp with nothing applied, and the reverse", async () => {
    await expect(insertReview({ applied_at: new Date().toISOString(), applied_edit_count: 0 }))
      .rejects.toThrow(/job_seeker_document_review_applied_together/);
    await expect(insertReview({ applied_at: null, applied_edit_count: 1 }))
      .rejects.toThrow(/job_seeker_document_review_applied_together/);
  });

  it("refuses accounting for more edits than were proposed", async () => {
    // One edit proposed cannot be both applied and rejected.
    await expect(insertReview({
      applied_at: new Date().toISOString(), applied_edit_count: 1, rejected_edit_count: 1,
    })).rejects.toThrow(/job_seeker_document_review_counts_within_proposal/);
  });

  it("refuses a critique that is not an array of entries", async () => {
    await expect(insertReview({ edits: { find: "a" } }))
      .rejects.toThrow(/job_seeker_document_review_edits_is_array/);
    await expect(insertReview({ narrative: "some prose" }))
      .rejects.toThrow(/job_seeker_document_review_narrative_is_array/);
  });

  it("always describes a version that still exists, because versions cannot be removed", async () => {
    // The cascade on document_id is a backstop that the append-only trigger
    // makes unreachable: a document version can be neither edited nor
    // deleted, so a stored review can never come to describe something that
    // is gone or something that has since changed underneath it.
    await expect(
      db.query("delete from public.job_seeker_documents where id = $1", [documentId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("update public.job_seeker_documents set content = 'x' where id = $1", [documentId]),
    ).rejects.toThrow(/append-only/);
  });

  it("leaves the document versions it reviewed untouched", async () => {
    // A revision is a NEW version, never an edit of the one reviewed, so
    // "which version did they actually send" stays answerable.
    const before = await db.query<{ content: string }>(
      "select content from public.job_seeker_documents where id = $1",
      [documentId],
    );
    await insertReview({ applied_at: new Date().toISOString(), applied_edit_count: 1 });
    const after = await db.query<{ content: string }>(
      "select content from public.job_seeker_documents where id = $1",
      [documentId],
    );
    expect(after.rows[0].content).toBe(before.rows[0].content);
  });
});
