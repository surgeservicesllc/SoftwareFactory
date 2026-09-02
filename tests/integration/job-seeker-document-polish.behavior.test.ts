// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedDatabase } from "../support/migrated-database";

/**
 * Document provenance (ADR-248): a baseline carries no model and no check;
 * a polished version carries both, and its check must say it passed. A
 * stored polish the check rejected is a contradiction the table refuses.
 */

const organizationId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";

async function assumeUser(db: PGlite, userId: string) {
  await db.exec(`
    set role authenticated;
    select set_config('request.jwt.claim.sub', '${userId}', false);
    select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false);
  `);
}

describe("document provenance (ADR-248)", { timeout: 180_000 }, () => {
  let db: PGlite;
  let applicationId: string;

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-polish', '${ownerId}');
    `);
    await assumeUser(db, ownerId);
    const job = await db.query<{ id: string }>(
      `insert into public.job_seeker_jobs (organization_id, user_id, source, title, company)
       values ($1, $2, 'manual', 'Platform Engineer', 'Acme') returning id`,
      [organizationId, ownerId],
    );
    const application = await db.query<{ id: string }>(
      `insert into public.job_seeker_applications (organization_id, user_id, job_id, stage)
       values ($1, $2, $3, 'READY_FOR_REVIEW') returning id`,
      [organizationId, ownerId, job.rows[0]!.id],
    );
    applicationId = application.rows[0]!.id;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("defaults a version to the baseline origin with no model and no check", async () => {
    const row = await db.query<{ origin: string; model: string | null; polish_check: unknown }>(
      `insert into public.job_seeker_documents (organization_id, user_id, application_id, kind, version, content)
       values ($1, $2, $3, 'resume', 1, 'Dana Reyes') returning origin, model, polish_check`,
      [organizationId, ownerId, applicationId],
    );
    expect(row.rows[0]).toEqual({ origin: "baseline", model: null, polish_check: null });
  });

  it("stores a polished version only with its model and a passing check", async () => {
    const stored = await db.query<{ origin: string; model: string }>(
      `insert into public.job_seeker_documents (organization_id, user_id, application_id, kind, version, content, origin, model, polish_check)
       values ($1, $2, $3, 'resume', 2, 'Dana Reyes, reworded', 'polished', 'claude-opus-5', '{"passed": true, "violations": []}'::jsonb)
       returning origin, model`,
      [organizationId, ownerId, applicationId],
    );
    expect(stored.rows[0]).toEqual({ origin: "polished", model: "claude-opus-5" });

    await expect(db.query(
      `insert into public.job_seeker_documents (organization_id, user_id, application_id, kind, version, content, origin)
       values ($1, $2, $3, 'resume', 3, 'no model', 'polished')`,
      [organizationId, ownerId, applicationId],
    )).rejects.toThrow(/origin_consistent/);

    await expect(db.query(
      `insert into public.job_seeker_documents (organization_id, user_id, application_id, kind, version, content, origin, model, polish_check)
       values ($1, $2, $3, 'resume', 3, 'rejected but stored', 'polished', 'claude-opus-5', '{"passed": false, "violations": [{"kind": "term", "value": "Terraform"}]}'::jsonb)`,
      [organizationId, ownerId, applicationId],
    )).rejects.toThrow(/polish_passed/);

    await expect(db.query(
      `insert into public.job_seeker_documents (organization_id, user_id, application_id, kind, version, content, origin)
       values ($1, $2, $3, 'resume', 3, 'unknown origin', 'imported')`,
      [organizationId, ownerId, applicationId],
    )).rejects.toThrow(/origin_known|origin_consistent/);
  });

  it("refuses a baseline that claims a model", async () => {
    await expect(db.query(
      `insert into public.job_seeker_documents (organization_id, user_id, application_id, kind, version, content, model)
       values ($1, $2, $3, 'cover_letter', 1, 'Dear Acme hiring team,', 'claude-opus-5')`,
      [organizationId, ownerId, applicationId],
    )).rejects.toThrow(/origin_consistent/);
  });
});
