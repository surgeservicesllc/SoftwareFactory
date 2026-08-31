// @vitest-environment node

import { createHash } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * The credential vault, against the real migrated schema.
 *
 * This is the first table in the repository allowed to hold credential
 * material, so the tests are about the conditions that made that acceptable:
 * no browser role can read the envelope, a sign-in code works exactly once,
 * and a code that is wrong, stale, or spent is refused identically.
 */


const ownerId = "00000000-0000-4000-8000-0000000000a1";
const memberId = "00000000-0000-4000-8000-0000000000a2";
const outsiderId = "00000000-0000-4000-8000-0000000000a3";
const organizationId = "10000000-0000-4000-8000-0000000000a1";

const envelope = "v1.aXZpdmluaXQxMjM0.dGFndGFndGFndGFndGFndGE=.c2VhbGVkZGF0YQ==";

function digest(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

async function assumeRole(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("provider credential vault", { timeout: 120_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-vault', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("lets an owner open a sign-in and claim it exactly once", async () => {
    const code = "first-code-value";
    await assumeRole(db, ownerId);
    await db.query("select public.open_provider_connect_session($1::uuid, $2, $3, 600)", [
      organizationId, "claude", digest(code),
    ]);
    await resetRole(db);

    const claimed = await db.query<{ claimed_purpose: string }>(
      "select claimed_purpose from public.claim_provider_connect_session($1, $2)",
      [digest(code), envelope],
    );
    expect(claimed.rows[0].claimed_purpose).toBe("claude");

    // Replaying the same code must fail. A connect code is a bearer credential
    // and a second use is either a mistake or an attack.
    await expect(db.query(
      "select * from public.claim_provider_connect_session($1, $2)",
      [digest(code), envelope],
    )).rejects.toThrow(/not valid/);
  });

  it("refuses a wrong, expired and spent code with the same message", async () => {
    const stale = "stale-code-value";
    await resetRole(db);
    // Inserted already-aged rather than opened and then back-dated: the
    // short-lived constraint correctly refuses an UPDATE that moves expiry
    // before creation, so an expired session can only be made by aging both.
    await db.query(`
      insert into public.provider_connect_sessions
        (organization_id, purpose, code_digest, expires_at, created_by, created_at)
      values ('${organizationId}', 'codex', $1,
              now() - interval '10 minutes', '${ownerId}', now() - interval '20 minutes')
    `, [digest(stale)]);

    const messages: string[] = [];
    for (const candidate of [digest("never-issued"), digest(stale)]) {
      try {
        await db.query("select * from public.claim_provider_connect_session($1, $2)",
          [candidate, envelope]);
      } catch (error) {
        messages.push((error as Error).message);
      }
    }

    expect(messages).toHaveLength(2);
    // Distinguishing them would tell someone probing codes which guesses landed.
    expect(messages[0]).toBe(messages[1]);
  });

  it("keeps only one open session per purpose", async () => {
    await assumeRole(db, ownerId);
    await db.query("select public.open_provider_connect_session($1::uuid, $2, $3, 600)", [
      organizationId, "gemini", digest("gemini-one"),
    ]);
    await db.query("select public.open_provider_connect_session($1::uuid, $2, $3, 600)", [
      organizationId, "gemini", digest("gemini-two"),
    ]);
    await resetRole(db);

    // The first code must stop working the moment a second is issued, or a
    // forgotten link stays live alongside the fresh one.
    await expect(db.query(
      "select * from public.claim_provider_connect_session($1, $2)",
      [digest("gemini-one"), envelope],
    )).rejects.toThrow(/not valid/);

    const second = await db.query("select * from public.claim_provider_connect_session($1, $2)",
      [digest("gemini-two"), envelope]);
    expect(second.rows).toHaveLength(1);
  });

  it("will not let a session outlive fifteen minutes", async () => {
    await resetRole(db);
    await expect(db.query(`
      insert into public.provider_connect_sessions
        (organization_id, purpose, code_digest, expires_at, created_by)
      values ('${organizationId}', 'longlived', repeat('a', 64), now() + interval '2 hours', '${ownerId}')
    `)).rejects.toThrow();
  });

  it("never exposes the envelope to a browser role", async () => {
    await assumeRole(db, ownerId);

    // No policy grants SELECT, and FORCE RLS applies to the owner too.
    await expect(db.query("select sealed_envelope from public.provider_credentials"))
      .rejects.toThrow(/permission denied/i);
    await expect(db.query("select code_digest from public.provider_connect_sessions"))
      .rejects.toThrow(/permission denied/i);

    // The presence projection is the only reader, and it cannot leak ciphertext
    // because the envelope is not in its returns clause.
    const listed = await db.query<Record<string, unknown>>(
      "select * from public.list_provider_credentials($1::uuid)", [organizationId],
    );
    await resetRole(db);

    expect(listed.rows.length).toBeGreaterThan(0);
    expect(Object.keys(listed.rows[0])).not.toContain("sealed_envelope");
    expect(JSON.stringify(listed.rows)).not.toContain("c2VhbGVkZGF0YQ");
  });

  it("keeps the ciphertext reader unreachable from every browser role", async () => {
    // `service_role` is deliberately excluded: it is the server's own identity
    // and the claim route has to call something. What it gets back is still
    // sealed, and the key that opens it is not in the database.
    for (const role of ["authenticated", "anon"]) {
      await db.exec("reset role");
      await db.exec(`set role ${role}`);
      await expect(db.query(
        "select public.read_provider_credential($1::uuid, $2)", [organizationId, "claude"],
      )).rejects.toThrow(/permission denied/i);
    }
    await resetRole(db);
  });

  it("requires manage rights to start or forget a sign-in", async () => {
    await assumeRole(db, memberId);
    await expect(db.query(
      "select public.open_provider_connect_session($1::uuid, $2, $3, 600)",
      [organizationId, "grok", digest("member-attempt")],
    )).rejects.toThrow(/owner or admin/);
    await expect(db.query(
      "select public.forget_provider_credential($1::uuid, $2)", [organizationId, "claude"],
    )).rejects.toThrow(/owner or admin/);
    await resetRole(db);
  });

  it("refuses an outsider entirely", async () => {
    await assumeRole(db, outsiderId);
    await expect(db.query(
      "select * from public.list_provider_credentials($1::uuid)", [organizationId],
    )).rejects.toThrow(/membership is required/);
    await resetRole(db);
  });

  it("clears the verified timestamp when a credential is replaced", async () => {
    await db.query(
      "update public.provider_credentials set last_verified_at = now() where purpose = 'claude'",
    );

    const code = "rotation-code-value";
    await assumeRole(db, ownerId);
    await db.query("select public.open_provider_connect_session($1::uuid, $2, $3, 600)", [
      organizationId, "claude", digest(code),
    ]);
    await resetRole(db);
    await db.query("select * from public.claim_provider_connect_session($1, $2)",
      [digest(code), envelope]);

    const { rows } = await db.query<{ last_verified_at: string | null; count: string }>(
      `select last_verified_at, (select count(*) from public.provider_credentials
        where organization_id = '${organizationId}' and purpose = 'claude') as count
       from public.provider_credentials
       where organization_id = '${organizationId}' and purpose = 'claude'`,
    );

    // Carrying the old timestamp forward would make a brand new token look as
    // though it had already been checked.
    expect(rows[0].last_verified_at).toBeNull();
    expect(Number(rows[0].count)).toBe(1);
  });

  it("refuses an envelope that is obviously not sealed", async () => {
    await resetRole(db);
    await expect(db.query(`
      insert into public.provider_credentials (organization_id, purpose, sealed_envelope, created_by)
      values ('${organizationId}', 'plaintext', 'sk-ant-oat01-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', '${ownerId}')
    `)).rejects.toThrow();
  });

  it("records an audit event for every sign-in and disconnect", async () => {
    const { rows } = await db.query<{ count: string }>(
      `select count(*) as count from public.activity_events
       where organization_id = '${organizationId}' and entity_type like 'provider_%'`,
    );

    expect(Number(rows[0].count)).toBeGreaterThan(0);
  });
});
