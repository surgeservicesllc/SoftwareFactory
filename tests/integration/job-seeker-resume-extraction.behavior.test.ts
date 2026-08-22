// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The extraction table and its apply function, against real PostgreSQL.
 *
 * PGlite runs as a superuser and so bypasses row level security. That makes it
 * the wrong tool for proving a policy holds and the right one for everything a
 * policy cannot express: that the constraints refuse what they claim to, that
 * `apply_resume_extraction` writes the profile and the audit row together, and
 * that it refuses a person applying someone else's reading — which matters
 * precisely because the function is SECURITY DEFINER and RLS is not what stops
 * that. The RLS assertions here read pg_class directly, which a superuser
 * cannot make lie.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000b001";
const otherId = "00000000-0000-4000-8000-00000000b002";
const organizationId = "10000000-0000-4000-8000-00000000b001";

let db: PGlite;
let uploadId: string;

async function asUser(userId: string) {
  await db.exec("reset role");
  // Explicit casts: PostgreSQL cannot infer a parameter's type inside
  // set_config, and reports it as "could not determine data type of parameter".
  await db.query("select set_config('request.jwt.claim.sub', $1::text, false)", [userId]);
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
    [userId],
  );
}

async function insertExtraction(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row = {
    status: "pattern_only",
    model: null as string | null,
    detail: "No model provider is configured on this server.",
    proposal: {
      fullName: "Dana Okafor",
      email: "dana.okafor@example.com",
      skills: ["Go", "TypeScript"],
      employmentHistory: [{ organization: "Northwind Systems", title: "Staff Platform Engineer" }],
    },
    sources: { fullName: "pattern", email: "pattern" },
    ...overrides,
  };
  const result = await db.query<{ id: string }>(
    `insert into public.job_seeker_resume_extractions
       (organization_id, user_id, upload_id, status, model, detail, proposal, sources)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      organizationId,
      userId,
      uploadId,
      row.status,
      row.model,
      row.detail,
      JSON.stringify(row.proposal),
      JSON.stringify(row.sources),
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
      ('${organizationId}', 'Seeker Co', 'seeker-co', '${ownerId}');
  `);
  for (const [userId, role] of [[ownerId, "owner"], [otherId, "member"]] as const) {
    await db.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, $3) on conflict (organization_id, user_id) do update set role = $3`,
      [organizationId, userId, role],
    );
  }
  const upload = await db.query<{ id: string }>(
    `insert into public.job_seeker_uploads
       (organization_id, user_id, kind, filename, content_type, byte_size, data)
     values ($1, $2, 'resume', 'resume.pdf', 'application/pdf', 5, '\\x4142434445'::bytea)
     returning id`,
    [organizationId, ownerId],
  );
  uploadId = upload.rows[0].id;
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the extraction table", () => {
  it("is protected the same way every other job_seeker table is", async () => {
    const result = await db.query<{
      rls: boolean; forced: boolean; policies: number; anon_select: boolean; authenticated_update: boolean;
    }>(`
      select relation.relrowsecurity as rls,
             relation.relforcerowsecurity as forced,
             (select count(*)::int from pg_policy where polrelid = relation.oid) as policies,
             has_table_privilege('anon', relation.oid, 'SELECT') as anon_select,
             has_table_privilege('authenticated', relation.oid, 'UPDATE') as authenticated_update
        from pg_class relation
        join pg_namespace space on space.oid = relation.relnamespace
       where space.nspname = 'public' and relation.relname = 'job_seeker_resume_extractions'`);

    expect(result.rows[0].rls).toBe(true);
    expect(result.rows[0].forced).toBe(true);
    expect(result.rows[0].policies).toBe(3);
    expect(result.rows[0].anon_select).toBe(false);
    /*
     * No UPDATE grant, deliberately. If a client could update this table it
     * could mark an extraction applied without the profile ever changing, and
     * the audit row would then describe something that did not happen.
     */
    expect(result.rows[0].authenticated_update).toBe(false);
  });

  it("refuses to record a review that cannot name the model that did it", async () => {
    // The one false claim this feature must never make.
    await expect(insertExtraction(ownerId, { status: "reviewed", model: null })).rejects.toThrow(
      /job_seeker_extraction_reviewed_names_model/,
    );
  });

  it("accepts a review that does name its model", async () => {
    const id = await insertExtraction(ownerId, { status: "reviewed", model: "claude-opus-5" });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses an applied_at with no record of what was applied", async () => {
    await expect(
      db.query(
        `insert into public.job_seeker_resume_extractions
           (organization_id, user_id, upload_id, status, detail, applied_at)
         values ($1, $2, $3, 'pattern_only', 'x', now())`,
        [organizationId, ownerId, uploadId],
      ),
    ).rejects.toThrow(/job_seeker_extraction_applied_together/);
  });

  it("disappears with the upload it read", async () => {
    // A person deleting their resume should not leave the reading of it behind.
    const upload = await db.query<{ id: string }>(
      `insert into public.job_seeker_uploads
         (organization_id, user_id, kind, filename, content_type, byte_size, data)
       values ($1, $2, 'resume', 'old.pdf', 'application/pdf', 3, '\\x414243'::bytea)
       returning id`,
      [organizationId, ownerId],
    );
    await db.query(
      `insert into public.job_seeker_resume_extractions
         (organization_id, user_id, upload_id, status, detail)
       values ($1, $2, $3, 'pattern_only', 'x')`,
      [organizationId, ownerId, upload.rows[0].id],
    );
    await db.query("delete from public.job_seeker_uploads where id = $1", [upload.rows[0].id]);

    const left = await db.query<{ count: number }>(
      "select count(*)::int as count from public.job_seeker_resume_extractions where upload_id = $1",
      [upload.rows[0].id],
    );
    expect(left.rows[0].count).toBe(0);
  });
});

describe("applying an extraction", () => {
  it("writes only the fields the person accepted", async () => {
    const id = await insertExtraction(ownerId);
    await asUser(ownerId);
    await db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [
      id,
      ["fullName", "skills"],
    ]);

    await db.exec("reset role");
    const profile = await db.query<{ full_name: string | null; email: string | null; skills: unknown }>(
      "select full_name, email, skills from public.job_seeker_profiles where user_id = $1",
      [ownerId],
    );
    expect(profile.rows[0].full_name).toBe("Dana Okafor");
    expect(profile.rows[0].skills).toEqual(["Go", "TypeScript"]);
    // Proposed but not accepted, so not written.
    expect(profile.rows[0].email).toBeNull();
  });

  it("records what was applied and stamps the time", async () => {
    const id = await insertExtraction(ownerId);
    await asUser(ownerId);
    const result = await db.query<{ applied_fields: string[]; applied_at: string }>(
      "select * from public.apply_resume_extraction($1::uuid, $2::text[])",
      [id, ["email"]],
    );
    expect(result.rows[0].applied_fields).toEqual(["email"]);
    expect(result.rows[0].applied_at).toBeTruthy();
  });

  it("writes an audit row naming the model, so a field can be traced later", async () => {
    const id = await insertExtraction(ownerId, { status: "reviewed", model: "claude-opus-5" });
    await asUser(ownerId);
    await db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [id, ["fullName"]]);

    await db.exec("reset role");
    const events = await db.query<{ event_type: string; metadata: Record<string, unknown> }>(
      `select event_type, metadata from public.activity_events
        where entity_id = $1 order by created_at desc limit 1`,
      [id],
    );
    expect(events.rows[0].event_type).toBe("job_seeker.profile_updated");
    expect(events.rows[0].metadata.model).toBe("claude-opus-5");
    expect(events.rows[0].metadata.applied_fields).toEqual(["fullName"]);
  });

  it("creates the profile for someone who has never filled one in", async () => {
    // The case this feature is most useful for: upload a resume first, before
    // typing anything at all.
    await db.exec("reset role");
    await db.query("delete from public.job_seeker_profiles where user_id = $1", [otherId]);
    const id = await insertExtraction(otherId);
    await asUser(otherId);
    await db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [id, ["fullName"]]);

    await db.exec("reset role");
    const profile = await db.query<{ full_name: string }>(
      "select full_name from public.job_seeker_profiles where user_id = $1",
      [otherId],
    );
    expect(profile.rows[0].full_name).toBe("Dana Okafor");
  });

  it("never blanks a column because a field was accepted but not proposed", async () => {
    /*
     * Accepting "summary" when the resume had no summary must leave whatever
     * the person already wrote. Writing null here would delete their work in
     * the name of applying a suggestion that did not exist.
     */
    await db.exec("reset role");
    await db.query(
      "update public.job_seeker_profiles set summary = 'Written by hand.' where user_id = $1",
      [ownerId],
    );
    const id = await insertExtraction(ownerId);
    await asUser(ownerId);
    await db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [
      id,
      ["fullName", "summary"],
    ]);

    await db.exec("reset role");
    const profile = await db.query<{ summary: string }>(
      "select summary from public.job_seeker_profiles where user_id = $1",
      [ownerId],
    );
    expect(profile.rows[0].summary).toBe("Written by hand.");
  });
});

describe("what applying refuses", () => {
  it("refuses a colleague applying someone else's resume reading", async () => {
    /*
     * The load-bearing refusal. This function is SECURITY DEFINER, so RLS is
     * not what stops a member of the same organization from rewriting a
     * colleague's career history — this check is.
     */
    const id = await insertExtraction(ownerId);
    await asUser(otherId);
    await expect(
      db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [id, ["fullName"]]),
    ).rejects.toThrow(/only be applied by the person it belongs to/);
  });

  it("refuses an anonymous caller", async () => {
    const id = await insertExtraction(ownerId);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await expect(
      db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [id, ["fullName"]]),
    ).rejects.toThrow(/authentication is required/);
  });

  it("refuses to apply the same reading twice", async () => {
    // Otherwise a double-clicked button silently re-applies stale values over
    // edits the person made in between.
    const id = await insertExtraction(ownerId);
    await asUser(ownerId);
    await db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [id, ["fullName"]]);
    await expect(
      db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [id, ["email"]]),
    ).rejects.toThrow(/already been applied/);
  });

  it("refuses a field name that is not a profile field", async () => {
    const id = await insertExtraction(ownerId);
    await asUser(ownerId);
    await expect(
      db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [id, ["salary_target"]]),
    ).rejects.toThrow(/is not a field a resume reading can apply/);
  });

  it("refuses an empty selection rather than reporting a no-op success", async () => {
    const id = await insertExtraction(ownerId);
    await asUser(ownerId);
    await expect(
      db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [id, []]),
    ).rejects.toThrow(/name at least one field/);
  });

  it("refuses when nothing named was actually in the proposal", async () => {
    const id = await insertExtraction(ownerId, { proposal: { email: "a@example.com" } });
    await asUser(ownerId);
    await expect(
      db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [id, ["summary"]]),
    ).rejects.toThrow(/none of those fields were found/);
  });

  it("refuses to apply a reading of a file it could not read", async () => {
    const id = await insertExtraction(ownerId, {
      status: "failed",
      model: null,
      proposal: {},
      detail: "The PDF could not be read.",
    });
    await asUser(ownerId);
    await expect(
      db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [id, ["fullName"]]),
    ).rejects.toThrow(/nothing to apply/);
  });

  it("refuses a reading that does not exist", async () => {
    await asUser(ownerId);
    await expect(
      db.query("select * from public.apply_resume_extraction($1::uuid, $2::text[])", [
        "00000000-0000-4000-8000-0000000000ff",
        ["fullName"],
      ]),
    ).rejects.toThrow(/no longer exists/);
  });
});
