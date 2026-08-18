// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * AI accounts and the auth-broker state machine, against the real migrated
 * schema.
 *
 * The account row is identity without secrets; the session row is the state a
 * worker drives while running the provider's real login. What these tests
 * defend is the shape of that split: no browser role can read the sealed relay
 * code, every transition happens through a definer function that also writes
 * an activity event, and a session that is expired, superseded, or finished
 * refuses to move again.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000000b1";
const memberId = "00000000-0000-4000-8000-0000000000b2";
const organizationId = "10000000-0000-4000-8000-0000000000b1";
const otherOrganizationId = "10000000-0000-4000-8000-0000000000b2";

// A syntactically valid sealed envelope, as sealSecret would produce. The
// database checks shape only; opening it is the application's job.
const envelope = "v1.aXZpdmluaXQxMjM0.dGFndGFndGFndGFndGFndGE=.c2VhbGVkZGF0YQ==";
const relayEnvelope = "v1.cmVsYXlpdjEyMzQ1.cmVsYXl0YWdyZWxheXRhZ3Q=.cmVsYXlkYXRh";

async function assumeRole(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("ai accounts and the auth broker", { timeout: 180_000 }, () => {
  let db: PGlite;

  async function createAccount(displayName: string, purpose: string): Promise<string> {
    await assumeRole(db, ownerId);
    const created = await db.query<{ create_ai_account: string }>(
      "select public.create_ai_account($1::uuid, 'anthropic', 'subscription', $2, $3)",
      [organizationId, displayName, purpose],
    );
    await resetRole(db);
    return created.rows[0].create_ai_account;
  }

  async function openSession(accountId: string): Promise<string> {
    await assumeRole(db, ownerId);
    const opened = await db.query<{ open_ai_auth_session: string }>(
      "select public.open_ai_auth_session($1::uuid, $2::uuid, 900)",
      [organizationId, accountId],
    );
    await resetRole(db);
    return opened.rows[0].open_ai_auth_session;
  }

  async function sessionStatus(sessionId: string): Promise<string> {
    const { rows } = await db.query<{ status: string }>(
      "select status from public.ai_auth_sessions where id = $1",
      [sessionId],
    );
    return rows[0].status;
  }

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
      values ('${organizationId}', 'Factory', 'factory-broker', '${ownerId}'),
             ('${otherOrganizationId}', 'Elsewhere', 'elsewhere-broker', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("walks a sign-in from Connect to a connected account with a sealed credential", async () => {
    const accountId = await createAccount("Claude account 1", "claude");
    const sessionId = await openSession(accountId);
    expect(await sessionStatus(sessionId)).toBe("pending");

    // A worker claims it and gets everything it needs — including the vault
    // purpose, which only the database knows.
    const claimed = await db.query<{
      claimed_session_id: string;
      claimed_purpose: string;
      claimed_provider: string;
    }>("select * from public.claim_ai_auth_session('github-actions-1')");
    expect(claimed.rows[0].claimed_session_id).toBe(sessionId);
    expect(claimed.rows[0].claimed_purpose).toBe("claude");
    expect(claimed.rows[0].claimed_provider).toBe("anthropic");

    // The CLI produced its login URL; the browser can now see it.
    const reported = await db.query<{ report_ai_auth_login_url: boolean }>(
      "select public.report_ai_auth_login_url($1::uuid, 'https://claude.ai/oauth/authorize?x=1')",
      [sessionId],
    );
    expect(reported.rows[0].report_ai_auth_login_url).toBe(true);

    await assumeRole(db, ownerId);
    const seen = await db.query<{ status: string; login_url: string }>(
      "select status, login_url from public.read_ai_auth_session($1::uuid, $2::uuid)",
      [organizationId, sessionId],
    );
    expect(seen.rows[0]).toMatchObject({
      status: "awaiting_user",
      login_url: "https://claude.ai/oauth/authorize?x=1",
    });

    // The person finished the provider login and pasted the confirmation code
    // into the web app — which sealed it before it got anywhere near a row.
    const attached = await db.query<{ attach_ai_auth_relay_code: boolean }>(
      "select public.attach_ai_auth_relay_code($1::uuid, $2::uuid, $3)",
      [organizationId, sessionId, relayEnvelope],
    );
    expect(attached.rows[0].attach_ai_auth_relay_code).toBe(true);
    await resetRole(db);

    // The worker collects the sealed code, verifies, and completes.
    const relay = await db.query<{ read_ai_auth_relay_code: string }>(
      "select public.read_ai_auth_relay_code($1::uuid)",
      [sessionId],
    );
    expect(relay.rows[0].read_ai_auth_relay_code).toBe(relayEnvelope);

    const verifying = await db.query<{ mark_ai_auth_session_verifying: boolean }>(
      "select public.mark_ai_auth_session_verifying($1::uuid)",
      [sessionId],
    );
    expect(verifying.rows[0].mark_ai_auth_session_verifying).toBe(true);

    const completed = await db.query<{ connected_purpose: string }>(
      "select connected_purpose from public.complete_ai_auth_session($1::uuid, $2)",
      [sessionId, envelope],
    );
    expect(completed.rows[0].connected_purpose).toBe("claude");

    expect(await sessionStatus(sessionId)).toBe("connected");
    const account = await db.query<{ status: string; last_verified_at: string | null }>(
      "select status, last_verified_at from public.ai_accounts where id = $1",
      [accountId],
    );
    expect(account.rows[0].status).toBe("connected");
    expect(account.rows[0].last_verified_at).not.toBeNull();

    // The credential landed in the vault under the account's purpose.
    const vault = await db.query<{ purpose: string }>(
      "select purpose from public.provider_credentials where organization_id = $1 and purpose = 'claude'",
      [organizationId],
    );
    expect(vault.rows).toHaveLength(1);

    // And the whole walk left an audit trail.
    const events = await db.query<{ count: string }>(
      `select count(*)::text as count from public.activity_events
       where organization_id = $1 and event_type = 'ai_account.changed'`,
      [organizationId],
    );
    expect(Number(events.rows[0].count)).toBeGreaterThanOrEqual(5);
  });

  it("never lets a browser role read the sealed relay code", async () => {
    await assumeRole(db, ownerId);
    // Direct table access is revoked outright.
    await expect(db.query("select relay_code_sealed from public.ai_auth_sessions")).rejects.toThrow();
    // And the projection's signature has no column that could carry it.
    const { fields } = await db.query(
      "select * from public.read_ai_auth_session($1::uuid, $2::uuid)",
      [organizationId, "00000000-0000-4000-8000-00000000ffff"],
    );
    expect(fields.map((f) => f.name)).not.toContain("relay_code_sealed");
    // The worker-side reader is not callable as a browser role at all.
    await expect(db.query(
      "select public.read_ai_auth_relay_code('00000000-0000-4000-8000-00000000ffff'::uuid)",
    )).rejects.toThrow(/permission denied/);
    await resetRole(db);
  });

  it("requires a manager for every owner-side mutation", async () => {
    await assumeRole(db, memberId);
    await expect(db.query(
      "select public.create_ai_account($1::uuid, 'anthropic', 'subscription', 'Blocked', 'claude_blocked')",
      [organizationId],
    )).rejects.toThrow(/owner or admin/);
    await expect(db.query(
      "select public.open_ai_auth_session($1::uuid, $2::uuid)",
      [organizationId, "00000000-0000-4000-8000-00000000ffff"],
    )).rejects.toThrow(/owner or admin/);
    await expect(db.query(
      "select public.disconnect_ai_account($1::uuid, $2::uuid)",
      [organizationId, "00000000-0000-4000-8000-00000000ffff"],
    )).rejects.toThrow(/owner or admin/);
    // A member can still see the accounts — read is a member operation.
    const listed = await db.query("select * from public.list_ai_accounts($1::uuid)", [organizationId]);
    expect(listed.rows.length).toBeGreaterThanOrEqual(1);
    await resetRole(db);
  });

  it("supersedes the previous open session instead of queueing a second worker", async () => {
    const accountId = await createAccount("Claude account 2", "claude_2");
    const first = await openSession(accountId);
    const second = await openSession(accountId);

    expect(await sessionStatus(first)).toBe("revoked");
    expect(await sessionStatus(second)).toBe("pending");
  });

  it("refuses two accounts on the same credential slot", async () => {
    await assumeRole(db, ownerId);
    await expect(db.query(
      "select public.create_ai_account($1::uuid, 'anthropic', 'subscription', 'Duplicate slot', 'claude')",
      [organizationId],
    )).rejects.toThrow(/duplicate key|unique/i);
    await resetRole(db);
  });

  it("treats an expired session as finished in every direction", async () => {
    const accountId = await createAccount("Claude account 3", "claude_3");
    const sessionId = await openSession(accountId);
    // Aged in place: created 20 minutes ago with a 10-minute life, satisfying
    // the bounded-life constraint while being past its expiry now.
    await db.query(
      `update public.ai_auth_sessions
       set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
       where id = $1`,
      [sessionId],
    );

    // Quarantine: revoke open sessions left by earlier tests so the only
    // claimable candidate would be the expired one — which must not be.
    await db.query(
      `update public.ai_auth_sessions set status = 'revoked'
       where status = 'pending' and id <> $1`,
      [sessionId],
    );
    const claimed = await db.query("select * from public.claim_ai_auth_session('late-worker')");
    expect(claimed.rows).toHaveLength(0);
    const relay = await db.query<{ read_ai_auth_relay_code: string | null }>(
      "select public.read_ai_auth_relay_code($1::uuid)",
      [sessionId],
    );
    expect(relay.rows[0].read_ai_auth_relay_code).toBeNull();
    await expect(db.query(
      "select * from public.complete_ai_auth_session($1::uuid, $2)",
      [sessionId, envelope],
    )).rejects.toThrow(/not in a completable state/);

    // Housekeeping makes the state say what is already true.
    const swept = await db.query<{ expire_ai_auth_sessions: number }>(
      "select public.expire_ai_auth_sessions()",
    );
    expect(swept.rows[0].expire_ai_auth_sessions).toBeGreaterThanOrEqual(1);
    expect(await sessionStatus(sessionId)).toBe("expired");
  });

  it("withholds a failure message that looks like it contains a credential", async () => {
    const accountId = await createAccount("Claude account 4", "claude_4");
    const sessionId = await openSession(accountId);

    const failed = await db.query<{ fail_ai_auth_session: boolean }>(
      "select public.fail_ai_auth_session($1::uuid, $2)",
      [sessionId, "login rejected: sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234 was refused"],
    );
    expect(failed.rows[0].fail_ai_auth_session).toBe(true);

    const { rows } = await db.query<{ failure_reason: string }>(
      "select failure_reason from public.ai_auth_sessions where id = $1",
      [sessionId],
    );
    expect(rows[0].failure_reason).not.toContain("sk-ant");
    expect(rows[0].failure_reason).toMatch(/withheld/);
  });

  it("disconnecting an account removes its sealed credential, not just its label", async () => {
    const accountId = await createAccount("Claude account 5", "claude_5");
    const sessionId = await openSession(accountId);
    await db.query("select * from public.claim_ai_auth_session('disconnect-worker')");
    await db.query(
      "select public.report_ai_auth_login_url($1::uuid, 'https://claude.ai/login')",
      [sessionId],
    );
    await assumeRole(db, ownerId);
    await db.query(
      "select public.attach_ai_auth_relay_code($1::uuid, $2::uuid, $3)",
      [organizationId, sessionId, relayEnvelope],
    );
    await resetRole(db);
    await db.query(
      "select * from public.complete_ai_auth_session($1::uuid, $2)",
      [sessionId, envelope],
    );

    await assumeRole(db, ownerId);
    const disconnected = await db.query<{ disconnect_ai_account: boolean }>(
      "select public.disconnect_ai_account($1::uuid, $2::uuid)",
      [organizationId, accountId],
    );
    expect(disconnected.rows[0].disconnect_ai_account).toBe(true);
    await resetRole(db);

    const vault = await db.query(
      "select 1 from public.provider_credentials where organization_id = $1 and purpose = 'claude_5'",
      [organizationId],
    );
    expect(vault.rows).toHaveLength(0);
    const account = await db.query<{ status: string }>(
      "select status from public.ai_accounts where id = $1",
      [accountId],
    );
    expect(account.rows[0].status).toBe("disconnected");
  });

  it("ties bots to accounts within the organization and leaves legacy bots alone", async () => {
    const accountId = await createAccount("Claude account 6", "claude_6");

    // A legacy bot with no account attached is untouched and valid.
    await db.query(`
      insert into public.bots (organization_id, name, provider, model, created_by)
      values ($1, 'Legacy bot', 'anthropic', 'claude-opus-5', $2)
    `, [organizationId, ownerId]);

    // Attaching an account from the same organization works.
    await db.query(
      "update public.bots set ai_account_id = $1 where organization_id = $2 and name = 'Legacy bot'",
      [accountId, organizationId],
    );

    // An account from another organization is refused by construction.
    await assumeRole(db, ownerId);
    const foreign = await db.query<{ create_ai_account: string }>(
      "select public.create_ai_account($1::uuid, 'anthropic', 'subscription', 'Foreign', 'claude')",
      [otherOrganizationId],
    );
    await resetRole(db);
    await expect(db.query(
      "update public.bots set ai_account_id = $1 where organization_id = $2 and name = 'Legacy bot'",
      [foreign.rows[0].create_ai_account, organizationId],
    )).rejects.toThrow(/foreign key/i);
  });

  it("describes recent sessions for the worker's log without the sealed code", async () => {
    const inspected = await db.query<Record<string, unknown>>(
      "select * from public.inspect_ai_auth_sessions(50)",
    );
    // The suites above created many sessions; the projection sees them.
    expect(inspected.rows.length).toBeGreaterThanOrEqual(3);
    const columns = Object.keys(inspected.rows[0]);
    expect(columns).toContain("inspected_status");
    expect(columns.join(",")).not.toMatch(/relay|sealed|login_url/);
    // Browser roles are denied outright.
    await assumeRole(db, ownerId);
    await expect(db.query("select * from public.inspect_ai_auth_sessions(5)"))
      .rejects.toThrow(/permission denied/);
    await resetRole(db);
  });

  it("finds the open session an account already has, so a refresh resumes it", async () => {
    const accountId = await createAccount("Claude account 9", "claude_9");
    const sessionId = await openSession(accountId);

    await assumeRole(db, ownerId);
    const found = await db.query<{ open_session_id: string; open_status: string }>(
      "select * from public.find_open_ai_auth_session($1::uuid, $2::uuid)",
      [organizationId, accountId],
    );
    expect(found.rows[0]).toMatchObject({ open_session_id: sessionId, open_status: "pending" });
    await resetRole(db);

    // Once terminal, there is nothing to resume.
    await db.query(
      "select public.fail_ai_auth_session($1::uuid, 'ended for the resume test')",
      [sessionId],
    );
    await assumeRole(db, ownerId);
    const after = await db.query(
      "select * from public.find_open_ai_auth_session($1::uuid, $2::uuid)",
      [organizationId, accountId],
    );
    expect(after.rows).toHaveLength(0);
    await resetRole(db);
  });

  it("cancels a reconnect without touching the established account or its credential", async () => {
    // An account that has ever connected predates the attempt being
    // cancelled; only never-connected pending accounts are discarded (the
    // owner's cancel-stores-nothing rule, covered by its own test below).
    const accountId = await createAccount("Claude account 8", "claude_8");
    await db.query(
      "update public.ai_accounts set status = 'needs_reauth' where id = $1",
      [accountId],
    );
    const sessionId = await openSession(accountId);

    await assumeRole(db, ownerId);
    const cancelled = await db.query<{ cancel_ai_auth_session: boolean }>(
      "select public.cancel_ai_auth_session($1::uuid, $2::uuid)",
      [organizationId, sessionId],
    );
    expect(cancelled.rows[0].cancel_ai_auth_session).toBe(true);
    // Cancelling twice is a no-op, not an error — the person double-clicked.
    const again = await db.query<{ cancel_ai_auth_session: boolean }>(
      "select public.cancel_ai_auth_session($1::uuid, $2::uuid)",
      [organizationId, sessionId],
    );
    expect(again.rows[0].cancel_ai_auth_session).toBe(false);
    await resetRole(db);

    expect(await sessionStatus(sessionId)).toBe("revoked");
    const account = await db.query<{ status: string }>(
      "select status from public.ai_accounts where id = $1",
      [accountId],
    );
    // The account is untouched: cancelling a sign-in is not disconnecting.
    expect(account.rows[0].status).toBe("needs_reauth");
  });

  it("supports high-numbered slots and enumerates stored purposes for the overlay", async () => {
    // No hard-coded maximum: slot 47 is as valid as slot 2, straight through
    // the schema's purpose pattern.
    const accountId = await createAccount("Claude account 47", "claude_47");
    const sessionId = await openSession(accountId);
    await db.query("select * from public.claim_ai_auth_session('slot-worker')");
    await db.query(
      "select public.report_ai_auth_login_url($1::uuid, 'https://claude.ai/login')",
      [sessionId],
    );
    await assumeRole(db, ownerId);
    await db.query(
      "select public.attach_ai_auth_relay_code($1::uuid, $2::uuid, $3)",
      [organizationId, sessionId, relayEnvelope],
    );
    await resetRole(db);
    await db.query(
      "select * from public.complete_ai_auth_session($1::uuid, $2)",
      [sessionId, envelope],
    );

    // The overlay bridge discovers the slot by enumeration — names only.
    const purposes = await db.query<{ list_provider_credential_purposes: string }>(
      "select public.list_provider_credential_purposes($1::uuid)",
      [organizationId],
    );
    const names = purposes.rows.map((row) => row.list_provider_credential_purposes);
    expect(names).toContain("claude_47");
    expect(names).toContain("claude");

    // And the enumeration is names only — no browser role may call it.
    await assumeRole(db, ownerId);
    await expect(db.query(
      "select public.list_provider_credential_purposes($1::uuid)",
      [organizationId],
    )).rejects.toThrow(/permission denied/);
    await resetRole(db);
  });

  it("removes a disconnected account, whose credential is already gone", async () => {
    /*
     * The state the owner's screenshot is in. Disconnect deletes the sealed
     * credential and keeps the row; Remove then finds nothing to delete from
     * the vault, and deleting no rows is not a failure. Only the happy path
     * had been covered, so removing an account in the state most likely to be
     * removed was untested.
     */
    const accountId = await createAccount("Codex Daniel", "codex_daniel");
    await assumeRole(db, ownerId);
    await db.query(
      "select public.disconnect_ai_account($1::uuid, $2::uuid)",
      [organizationId, accountId],
    );
    const removed = await db.query<{ remove_ai_account: boolean }>(
      "select public.remove_ai_account($1::uuid, $2::uuid)",
      [organizationId, accountId],
    );
    expect(removed.rows[0].remove_ai_account).toBe(true);
    await resetRole(db);

    const rows = await db.query("select 1 from public.ai_accounts where id = $1", [accountId]);
    expect(rows.rows).toHaveLength(0);
  });

  it("answers false for an account that is not there, rather than raising", async () => {
    // Removing twice — a double click, or two tabs — is the state the person
    // wanted, so the second attempt is not an error.
    const accountId = await createAccount("Removed twice", "removed_twice");
    await assumeRole(db, ownerId);
    await db.query(
      "select public.remove_ai_account($1::uuid, $2::uuid)", [organizationId, accountId],
    );
    const again = await db.query<{ remove_ai_account: boolean }>(
      "select public.remove_ai_account($1::uuid, $2::uuid)", [organizationId, accountId],
    );
    expect(again.rows[0].remove_ai_account).toBe(false);
    await resetRole(db);
  });

  it("refuses a member with 42501 and the sentence the console shows", async () => {
    /*
     * The code and the message together. The console reported "(42501)" with
     * no words, which cannot be told apart from a missing table privilege —
     * also 42501. This is the message a person is meant to read.
     */
    const accountId = await createAccount("Member cannot remove", "member_cannot");
    await assumeRole(db, memberId);
    await expect(
      db.query("select public.remove_ai_account($1::uuid, $2::uuid)", [organizationId, accountId]),
    ).rejects.toMatchObject({
      code: "42501",
      message: "owner or admin role is required to remove an AI account",
    });
    await resetRole(db);
  });

  it("refuses an outsider's organization id without disclosing whether it exists", async () => {
    const accountId = await createAccount("Outsider probe", "outsider_probe");
    await assumeRole(db, memberId);
    await expect(
      db.query(
        "select public.remove_ai_account($1::uuid, $2::uuid)",
        [otherOrganizationId, accountId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await resetRole(db);

    const still = await db.query("select 1 from public.ai_accounts where id = $1", [accountId]);
    expect(still.rows).toHaveLength(1);
  });

  it("removing an account deletes it whole but detaches bots rather than deleting them", async () => {
    const accountId = await createAccount("Claude account 10", "claude_10");
    const sessionId = await openSession(accountId);
    // Give it a credential and a referencing bot, so removal has real stakes.
    await db.query(
      `insert into public.provider_credentials
         (organization_id, purpose, sealed_envelope, source, created_by)
       values ($1, 'claude_10', $2, 'connect_session', $3)`,
      [organizationId, envelope, ownerId],
    );
    await db.query(`
      insert into public.bots (organization_id, name, provider, model, created_by, ai_account_id)
      values ($1, 'Remove-test bot', 'anthropic', 'claude-opus-5', $2, $3)
    `, [organizationId, ownerId, accountId]);
    /*
     * And recorded usage evidence — the state every real account reaches
     * within minutes of connecting, because the sweep records constantly.
     * This is exactly what made removal impossible on the hosted database:
     * the old foreign key cascaded the account delete into this append-only
     * table, whose trigger refused it with 42501 (probe run 32188102707).
     * Triggers fire for superusers too, so this reproduces the hosted
     * failure locally with no RLS caveat.
     */
    await db.query(`
      insert into public.ai_account_usage_observations
        (organization_id, ai_account_id, status, windows, detail)
      values ($1, $2, 'unavailable', '[]'::jsonb, 'recorded before removal')
    `, [organizationId, accountId]);

    await assumeRole(db, ownerId);
    const removed = await db.query<{ remove_ai_account: boolean }>(
      "select public.remove_ai_account($1::uuid, $2::uuid)",
      [organizationId, accountId],
    );
    expect(removed.rows[0].remove_ai_account).toBe(true);
    await resetRole(db);

    const account = await db.query(
      "select 1 from public.ai_accounts where id = $1", [accountId],
    );
    expect(account.rows).toHaveLength(0);
    const session = await db.query(
      "select 1 from public.ai_auth_sessions where id = $1", [sessionId],
    );
    expect(session.rows).toHaveLength(0);
    const credential = await db.query(
      "select 1 from public.provider_credentials where organization_id = $1 and purpose = 'claude_10'",
      [organizationId],
    );
    expect(credential.rows).toHaveLength(0);
    // The bot survives, detached.
    const bot = await db.query<{ ai_account_id: string | null }>(
      "select ai_account_id from public.bots where name = 'Remove-test bot'",
    );
    expect(bot.rows).toHaveLength(1);
    expect(bot.rows[0].ai_account_id).toBeNull();
    // The usage evidence survives too: append-only history outlives the
    // account it measured, exactly like activity events.
    const evidence = await db.query(
      "select 1 from public.ai_account_usage_observations where ai_account_id = $1",
      [accountId],
    );
    expect(evidence.rows).toHaveLength(1);
  });

  it("completes a device-flow sign-in that never pastes a code", async () => {
    // The device flow's exact state walk: claim → URL → the person approves
    // on the provider's page — no relay code ever attaches, so the session
    // goes awaiting_user → verifying → connected on the worker's word alone.
    const accountId = await createAccount("Codex device flow", "codex_dev");
    const sessionId = await openSession(accountId);
    await db.query("select * from public.claim_ai_auth_session('device-worker')");
    await db.query(
      "select public.report_ai_auth_login_url($1::uuid, 'https://auth.openai.com/codex/device#sf-device-code=ABCD-EFGHI')",
      [sessionId],
    );
    expect(await sessionStatus(sessionId)).toBe("awaiting_user");

    const verifying = await db.query<{ mark_ai_auth_session_verifying: boolean }>(
      "select public.mark_ai_auth_session_verifying($1::uuid)",
      [sessionId],
    );
    expect(verifying.rows[0].mark_ai_auth_session_verifying).toBe(true);

    const completed = await db.query(
      "select * from public.complete_ai_auth_session($1::uuid, $2)",
      [sessionId, envelope],
    );
    expect(completed.rows).toHaveLength(1);
    expect(await sessionStatus(sessionId)).toBe("connected");
    const account = await db.query<{ status: string }>(
      "select status from public.ai_accounts where id = $1", [accountId],
    );
    expect(account.rows[0].status).toBe("connected");
  });

  it("seals a credential as large as providers actually mint them", async () => {
    // A Codex credential is the CLI's whole auth file and seals past the old
    // 8192-character cap — the very last step of a fully-approved sign-in
    // was refused by the schema. Live failure, 2026-08-16 18:44Z.
    const accountId = await createAccount("Codex big envelope", "codex_big");
    const sessionId = await openSession(accountId);
    await db.query("select * from public.claim_ai_auth_session('big-worker')");
    await db.query(
      "select public.report_ai_auth_login_url($1::uuid, 'https://auth.openai.com/codex/device')",
      [sessionId],
    );
    await assumeRole(db, ownerId);
    await db.query(
      "select public.attach_ai_auth_relay_code($1::uuid, $2::uuid, $3)",
      [organizationId, sessionId, relayEnvelope],
    );
    await resetRole(db);

    const bigEnvelope = `v1.${"QUJD".repeat(60)}.${"REVG".repeat(60)}.${"A".repeat(14_000)}=`;
    expect(bigEnvelope.length).toBeGreaterThan(8_192);
    const completed = await db.query(
      "select * from public.complete_ai_auth_session($1::uuid, $2)",
      [sessionId, bigEnvelope],
    );
    expect(completed.rows).toHaveLength(1);
    const stored = await db.query<{ length: number }>(
      "select char_length(sealed_envelope) as length from public.provider_credentials where organization_id = $1 and purpose = 'codex_big'",
      [organizationId],
    );
    expect(stored.rows[0].length).toBe(bigEnvelope.length);
  });

  it("cancel discards a never-connected account, and only that", async () => {
    // A pending account exists only because Connect provisioned it; the
    // owner's rule is that cancel stores nothing.
    const freshId = await createAccount("Cancel discard target", "claude_cx1");
    const freshSession = await openSession(freshId);
    await assumeRole(db, ownerId);
    const cancelled = await db.query<{ cancel_ai_auth_session: boolean }>(
      "select public.cancel_ai_auth_session($1::uuid, $2::uuid)",
      [organizationId, freshSession],
    );
    expect(cancelled.rows[0].cancel_ai_auth_session).toBe(true);
    await resetRole(db);
    expect((await db.query(
      "select 1 from public.ai_accounts where id = $1", [freshId],
    )).rows).toHaveLength(0);
    expect((await db.query(
      "select 1 from public.ai_auth_sessions where id = $1", [freshSession],
    )).rows).toHaveLength(0);

    // An account that has ever connected is never cancel's to delete —
    // cancelling a Reconnect attempt keeps the account whole.
    const keptId = await createAccount("Cancel keep target", "claude_cx2");
    await db.query(
      "update public.ai_accounts set status = 'needs_reauth' where id = $1",
      [keptId],
    );
    const keptSession = await openSession(keptId);
    await assumeRole(db, ownerId);
    await db.query(
      "select public.cancel_ai_auth_session($1::uuid, $2::uuid)",
      [organizationId, keptSession],
    );
    await resetRole(db);
    const kept = await db.query<{ status: string }>(
      "select status from public.ai_accounts where id = $1", [keptId],
    );
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0].status).toBe("needs_reauth");
  });

  it("renames a bot without touching its readiness, under the same constraints", async () => {
    await db.query(`
      insert into public.bots (organization_id, name, provider, model, created_by, readiness)
      values ($1, 'Rename-test bot', 'anthropic', 'claude-opus-5', $2, 'ready'),
             ($1, 'Rename-test sibling', 'anthropic', 'claude-opus-5', $2, 'ready')
    `, [organizationId, ownerId]);
    const botId = (await db.query<{ id: string }>(
      "select id from public.bots where name = 'Rename-test bot'",
    )).rows[0].id;

    await assumeRole(db, ownerId);
    const renamed = await db.query<{ rename_bot: boolean }>(
      "select public.rename_bot($1::uuid, $2::uuid, $3)",
      [organizationId, botId, "  Deploy Reviewer  "],
    );
    expect(renamed.rows[0].rename_bot).toBe(true);

    await expect(db.query(
      "select public.rename_bot($1::uuid, $2::uuid, $3)",
      [organizationId, botId, "Rename-test sibling"],
    )).rejects.toThrow(/already uses that name/);

    await expect(db.query(
      "select public.rename_bot($1::uuid, $2::uuid, $3)",
      [organizationId, botId, "sk-ant-oat01-ABCdef0123456789_-ABCdef0123456789"],
    )).rejects.toThrow(/looks like it contains a credential/);
    await resetRole(db);

    // The label changed; readiness — which a rename proves nothing about —
    // did not. This is the difference from update_bot, which resets it.
    const bot = await db.query<{ name: string; readiness: string }>(
      "select name, readiness from public.bots where id = $1", [botId],
    );
    expect(bot.rows[0].name).toBe("Deploy Reviewer");
    expect(bot.rows[0].readiness).toBe("ready");
  });

  it("renames an account under the create-path constraints, and identity stays worker-reported", async () => {
    const accountId = await createAccount("Rename target", "claude_rn1");
    const siblingId = await createAccount("Rename sibling", "claude_rn2");

    // The worker records which provider account signed in — display data.
    const identity = await db.query<{ set_ai_account_provider_identity: boolean }>(
      "select public.set_ai_account_provider_identity($1::uuid, $2)",
      [accountId, "owner@example.com"],
    );
    expect(identity.rows[0].set_ai_account_provider_identity).toBe(true);

    // A credential-shaped identity is refused without an error: the sign-in
    // it arrived from succeeded, and nothing secret may land on the row.
    const refused = await db.query<{ set_ai_account_provider_identity: boolean }>(
      "select public.set_ai_account_provider_identity($1::uuid, $2)",
      [accountId, "sk-ant-oat01-ABCdef0123456789_-ABCdef0123456789"],
    );
    expect(refused.rows[0].set_ai_account_provider_identity).toBe(false);

    await assumeRole(db, ownerId);
    const renamed = await db.query<{ rename_ai_account: boolean }>(
      "select public.rename_ai_account($1::uuid, $2::uuid, $3)",
      [organizationId, accountId, "  Production Claude  "],
    );
    expect(renamed.rows[0].rename_ai_account).toBe(true);

    await expect(db.query(
      "select public.rename_ai_account($1::uuid, $2::uuid, $3)",
      [organizationId, siblingId, "Production Claude"],
    )).rejects.toThrow(/already uses that name/);

    await expect(db.query(
      "select public.rename_ai_account($1::uuid, $2::uuid, $3)",
      [organizationId, accountId, "sk-ant-oat01-ABCdef0123456789_-ABCdef0123456789"],
    )).rejects.toThrow(/looks like it contains a credential/);
    await resetRole(db);

    // A member cannot rename.
    await assumeRole(db, memberId);
    await expect(db.query(
      "select public.rename_ai_account($1::uuid, $2::uuid, $3)",
      [organizationId, accountId, "Member rename"],
    )).rejects.toThrow(/owner or admin/);
    await resetRole(db);

    // The rename landed trimmed, the identity survived it, and the list
    // projection carries both.
    await assumeRole(db, ownerId);
    const listed = await db.query<{ display_name: string; provider_identity: string | null }>(
      "select display_name, provider_identity from public.list_ai_accounts($1::uuid) where account_id = $2::uuid",
      [organizationId, accountId],
    );
    await resetRole(db);
    expect(listed.rows[0].display_name).toBe("Production Claude");
    expect(listed.rows[0].provider_identity).toBe("owner@example.com");
  });

  it("demotes an account to needs_reauth when its credential stops working", async () => {
    const accountId = await createAccount("Claude account 7", "claude_7");
    const marked = await db.query<{ mark_ai_account_needs_reauth: boolean }>(
      "select public.mark_ai_account_needs_reauth($1::uuid, $2::uuid, 'The provider refused the stored token.')",
      [organizationId, accountId],
    );
    expect(marked.rows[0].mark_ai_account_needs_reauth).toBe(true);

    const account = await db.query<{ status: string; last_error: string }>(
      "select status, last_error from public.ai_accounts where id = $1",
      [accountId],
    );
    expect(account.rows[0].status).toBe("needs_reauth");
    expect(account.rows[0].last_error).toContain("refused");
  });

  it("enumerates only connected accounts for verification, and a pass is a timestamp", async () => {
    // From the tests above, at least one account is connected (the happy
    // walk) and at least one is needs_reauth (the demotion just before).
    const listed = await db.query<{
      verifiable_account_id: string; verifiable_purpose: string;
    }>("select * from public.list_ai_accounts_for_verification()");
    const purposes = listed.rows.map((row) => row.verifiable_purpose);
    expect(purposes).toContain("claude");
    // The demoted account is not swept: a seal-open pass cannot disprove a
    // provider refusal, so needs_reauth is repaired by a person, not a sweep.
    expect(purposes).not.toContain("claude_7");

    const connectedId = listed.rows.find((row) => row.verifiable_purpose === "claude")!
      .verifiable_account_id;
    const before = await db.query<{ last_verified_at: string }>(
      "select last_verified_at from public.ai_accounts where id = $1", [connectedId],
    );
    const marked = await db.query<{ mark_ai_account_verified: boolean }>(
      "select public.mark_ai_account_verified($1::uuid, $2::uuid)",
      [organizationId, connectedId],
    );
    expect(marked.rows[0].mark_ai_account_verified).toBe(true);
    const after = await db.query<{ last_verified_at: string }>(
      "select last_verified_at from public.ai_accounts where id = $1", [connectedId],
    );
    expect(new Date(after.rows[0].last_verified_at).getTime())
      .toBeGreaterThanOrEqual(new Date(before.rows[0].last_verified_at).getTime());

    // And a non-connected account refuses the pass rather than lying.
    const demoted = await db.query<{ id: string }>(
      "select id from public.ai_accounts where credential_purpose = 'claude_7' and organization_id = $1",
      [organizationId],
    );
    const refused = await db.query<{ mark_ai_account_verified: boolean }>(
      "select public.mark_ai_account_verified($1::uuid, $2::uuid)",
      [organizationId, demoted.rows[0].id],
    );
    expect(refused.rows[0].mark_ai_account_verified).toBe(false);

    // Browser roles cannot call either function.
    await assumeRole(db, ownerId);
    await expect(db.query("select * from public.list_ai_accounts_for_verification()"))
      .rejects.toThrow(/permission denied/);
    await resetRole(db);
  });
});
