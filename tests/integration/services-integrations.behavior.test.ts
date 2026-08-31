// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LATEST_MIGRATION } from "../support/latest-migration";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

/**
 * The provider integration registry (ADR-207) against the real chain.
 *
 * This suite is about one claim and the ways it could become false: a
 * workspace says a capability is live ONLY when a sealed credential for it
 * actually exists. Everything else — an enabled switch, a display label, a
 * settings blob — is somebody's intention, and intention is not capability.
 *
 * The failure this prevents is specific and is the worst kind: a page that
 * reads "Connected" while nothing sends. So the tests below try to produce
 * that state by every route the schema allows.
 */

/*
 * Credential-shaped fixtures, assembled at runtime.
 *
 * A literal key in a test file is a bad fixture even when it is invented:
 * GitHub's push protection rejects the branch, every future scanner
 * flags it again, and the repository learns to wave the signal through.
 * These are built by concatenation so no key-shaped literal is ever in
 * the file — which is also how the Stripe gap below got found.
 */
const BEARER_TOKEN = `bearer ${"a".repeat(30)}`;
const STRIPE_SHAPED = ["sk", "live", "a".repeat(24)].join("_");

const acmeOwner = "00000000-0000-4000-8000-00000000e101";
const rivalOwner = "00000000-0000-4000-8000-00000000e102";
const acmeOrg = "10000000-0000-4000-8000-00000000e101";
const rivalOrg = "10000000-0000-4000-8000-00000000e102";

describe("the provider integration registry", { timeout: 240_000 }, () => {
  let db: PGlite;

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function reset() {
    await db.exec("reset role");
  }

  async function statusFor(provider: string) {
    const result = await db.query<{
      provider: string;
      configured: boolean;
      enabled: boolean;
      credential_present: boolean;
      live: boolean;
    }>("select * from public.crm_integration_status($1) where provider = $2", [acmeOrg, provider]);
    return result.rows[0];
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        email text,
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
      grant usage on schema auth to anon, authenticated, service_role;
    `);

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrationFiles.at(-1)).toBe(LATEST_MIGRATION);
    for (const file of migrationFiles) {
      if (file === "20260830000500_services_crm_foundation.sql") {
        await db.exec(`
          alter default privileges in schema public grant all privileges on tables to authenticated;
          alter default privileges in schema public grant all privileges on tables to service_role;
        `);
      }
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${acmeOwner}'), ('${rivalOwner}');
      insert into public.organizations (id, name, slug, created_by)
      values
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-integrations', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-integrations', '${rivalOwner}');
    `);
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("reports every provider, including the ones nobody has configured", async () => {
    await as(acmeOwner);
    const all = await db.query<{ provider: string; configured: boolean; live: boolean }>(
      "select * from public.crm_integration_status($1)", [acmeOrg],
    );
    // A capability the workspace does NOT have is exactly what a page needs
    // to be told about, so an unconfigured provider is a row, not a gap.
    expect(all.rows.map((row) => row.provider)).toEqual([
      "sms", "email", "card_payments", "gps_telemetry",
      "accounting", "telephony", "reviews", "mapping",
    ]);
    expect(all.rows.every((row) => !row.configured)).toBe(true);
    expect(all.rows.every((row) => !row.live)).toBe(true);
    await reset();
  });

  it("will not call a provider live because somebody switched it on", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_service_integrations
         (organization_id, provider, credential_purpose, display_label, enabled, created_by)
       values ($1, 'sms', 'crm_sms_provider', 'Field reminders', true, $2)`,
      [acmeOrg, acmeOwner],
    );

    const sms = await statusFor("sms");
    expect(sms.configured).toBe(true);
    expect(sms.enabled).toBe(true);
    // Enabled and configured, and still NOT live — because no credential
    // exists. This is the assertion the whole increment is for: a member
    // can express an intention and cannot manufacture a capability.
    expect(sms.credential_present).toBe(false);
    expect(sms.live).toBe(false);

    expect(
      (await db.query<{ live: boolean }>(
        "select public.crm_integration_live($1, 'sms') as live", [acmeOrg],
      )).rows[0].live,
    ).toBe(false);
    await reset();
  });

  it("turns live the moment a sealed credential exists, and back when it goes", async () => {
    // The vault write is a server-side act; the seal is opaque here and is
    // exactly what a real connect session would have stored.
    await reset();
    await db.query(
      `insert into public.provider_credentials
         (organization_id, purpose, sealed_envelope, source, created_by)
       values ($1, 'crm_sms_provider', 'v1.aGVsbG8td29ybGQtc2VhbGVkLWVudmVsb3Bl', 'connect_session', $2)`,
      [acmeOrg, acmeOwner],
    );

    await as(acmeOwner);
    const connected = await statusFor("sms");
    expect(connected.credential_present).toBe(true);
    expect(connected.live).toBe(true);
    expect(
      (await db.query<{ live: boolean }>(
        "select public.crm_integration_live($1, 'sms') as live", [acmeOrg],
      )).rows[0].live,
    ).toBe(true);

    // Switching it off is an owner's decision and takes effect at once,
    // without touching the credential.
    await db.query(
      "update public.crm_service_integrations set enabled = false where organization_id = $1 and provider = 'sms'",
      [acmeOrg],
    );
    const paused = await statusFor("sms");
    expect(paused.credential_present).toBe(true);
    expect(paused.live).toBe(false);

    await db.query(
      "update public.crm_service_integrations set enabled = true where organization_id = $1 and provider = 'sms'",
      [acmeOrg],
    );
    await reset();

    // And removing the credential takes it down even though the switch is
    // still on — the derivation looks at the vault every time.
    await db.query(
      "delete from public.provider_credentials where organization_id = $1 and purpose = 'crm_sms_provider'",
      [acmeOrg],
    );
    await as(acmeOwner);
    const gone = await statusFor("sms");
    expect(gone.enabled).toBe(true);
    expect(gone.credential_present).toBe(false);
    expect(gone.live).toBe(false);
    await reset();
  });

  it("does not let a credential filed under another purpose stand in", async () => {
    await reset();
    await db.query(
      `insert into public.provider_credentials
         (organization_id, purpose, sealed_envelope, source, created_by)
       values ($1, 'crm_email_provider', 'v1.YW5vdGhlci1zZWFsZWQtZW52ZWxvcGUtaGVyZQ', 'connect_session', $2)`,
      [acmeOrg, acmeOwner],
    );
    await as(acmeOwner);
    // An email credential does not make SMS live. The join is on the
    // purpose this integration names, not on "any credential at all".
    expect((await statusFor("sms")).live).toBe(false);
    await reset();
  });

  it("refuses a key pasted into the label or the settings blob", async () => {
    await as(acmeOwner);
    // The settings object is the likeliest place somebody drops a token
    // "just for now", so the schema refuses it rather than leaving it to
    // be found in a database dump.
    await expect(
      db.query(
        `insert into public.crm_service_integrations
           (organization_id, provider, credential_purpose, settings, created_by)
         values ($1, 'email', 'crm_email_provider',
                 jsonb_build_object('api_key', $3::text), $2)`,
        [acmeOrg, acmeOwner, BEARER_TOKEN],
      ),
    ).rejects.toThrow(/settings_no_secret|text_has_likely_secret/);

    await expect(
      db.query(
        `insert into public.crm_service_integrations
           (organization_id, provider, credential_purpose, display_label, created_by)
         values ($1, 'email', 'crm_email_provider', $3, $2)`,
        [acmeOrg, acmeOwner, BEARER_TOKEN],
      ),
    ).rejects.toThrow(/label_no_secret|text_has_likely_secret/);
    await reset();
  });

  it("refuses a credential pasted into the purpose name, which the shape check alone would allow", async () => {
    await as(acmeOwner);
    /*
     * A Stripe secret key is lower-case and underscored, so it satisfies
     * the purpose-name PATTERN exactly. The pattern was never going to
     * catch it; the secret guard is what does. A purpose name is the
     * least likely place somebody pastes a key, which makes it the worst
     * one to leave unguarded.
     *
     * And the guard only catches it as of ADR-209 — it held OpenAI's
     * `sk-` with a hyphen and had no Stripe pattern at all, so this
     * assertion failed for the right reason only after that fix.
     */
    await expect(
      db.query(
        `insert into public.crm_service_integrations
           (organization_id, provider, credential_purpose, created_by)
         values ($1, 'accounting', $3, $2)`,
        [acmeOrg, acmeOwner, STRIPE_SHAPED],
      ),
    ).rejects.toThrow(/text_has_likely_secret|credential_purpose/);

    // And an ordinary purpose name still goes in.
    await db.query(
      `insert into public.crm_service_integrations
         (organization_id, provider, credential_purpose, created_by)
       values ($1, 'accounting', 'crm_accounting_provider', $2)`,
      [acmeOrg, acmeOwner],
    );
    await reset();
  });

  it("keeps one row per provider per workspace", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_service_integrations
           (organization_id, provider, credential_purpose, created_by)
         values ($1, 'sms', 'crm_sms_second', $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_service_integrations_org_provider_key|duplicate key/);
    await reset();
  });

  it("tells a stranger nothing, and refuses to answer about another workspace", async () => {
    await as(rivalOwner);
    // The rival is a member of their own organization and of nothing else.
    await expect(
      db.query("select * from public.crm_integration_status($1)", [acmeOrg]),
    ).rejects.toThrow(/organization membership is required/);
    await expect(
      db.query("select public.crm_integration_live($1, 'sms')", [acmeOrg]),
    ).rejects.toThrow(/organization membership is required/);

    // Their own workspace answers, and answers "nothing is live".
    const own = await db.query<{ live: boolean }>(
      "select * from public.crm_integration_status($1)", [rivalOrg],
    );
    expect(own.rows).toHaveLength(8);
    expect(own.rows.every((row) => !row.live)).toBe(true);

    const rows = await db.query("select * from public.crm_service_integrations");
    expect(rows.rows).toHaveLength(0);
    await reset();
  });

  it("never puts a sealed envelope in reach of the status read", async () => {
    // The function's RETURNS clause is the guarantee: no future edit to
    // its body can leak the envelope without also changing the signature.
    const signature = await db.query<{ result: string }>(
      `select pg_get_function_result(p.oid) as result
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'crm_integration_status'`,
    );
    expect(signature.rows[0].result).not.toMatch(/envelope|sealed|secret/i);
    expect(signature.rows[0].result).toMatch(/credential_present boolean/);

    // And no browser role can read the vault table directly, which is what
    // makes the definer necessary in the first place.
    for (const role of ["anon", "authenticated"]) {
      const allowed = await db.query<{ allowed: boolean }>(
        "select has_table_privilege($1, 'public.provider_credentials', 'select') as allowed",
        [role],
      );
      expect(allowed.rows[0].allowed).toBe(false);
    }
  });
});
