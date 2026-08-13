// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Executable proof that the marketing schema behaves as designed.
 *
 * The hosted database cannot be reached from this environment, so the migration
 * chain is applied to an in-process PostgreSQL and exercised as the real roles.
 * This verifies the guarantees the contract tests can only assert textually:
 * anonymous readers see published rows and nothing else, no browser role can
 * write to the content tables, subscriber rows are unreadable, and the one
 * public write path validates its input inside the database.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

const migrationFiles = [
  "20260812000100_control_plane_schema.sql",
  "20260812000200_row_level_security.sql",
  "20260813000400_marketing_content.sql",
] as const;

const CONTENT_TABLES = [
  "marketing_pages",
  "marketing_stats",
  "marketing_features",
  "marketing_pricing_plans",
  "marketing_plan_features",
  "marketing_resources",
  "marketing_resource_topics",
  "marketing_team_members",
  "marketing_testimonials",
  "marketing_logos",
] as const;

async function assumeRole(db: PGlite, role: "anon" | "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
}

async function rejects(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the statement to be rejected");
}

describe("marketing schema RLS behavior", () => {
  let db: PGlite;

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

    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(repositoryRoot, "supabase/migrations", file), "utf8"));
    }
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("applies cleanly, including the seed, with the sensitive-data guard active", async () => {
    await resetRole(db);
    const pages = await db.query<{ count: number }>(
      "select count(*)::int as count from public.marketing_pages",
    );
    const plans = await db.query<{ count: number }>(
      "select count(*)::int as count from public.marketing_pricing_plans",
    );

    expect(pages.rows[0].count).toBe(7);
    expect(plans.rows[0].count).toBe(4);
  });

  it("keeps row security enabled and forced on every table it adds", async () => {
    await resetRole(db);
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity
       from pg_class
       where relnamespace = 'public'::regnamespace
         and relkind = 'r'
         and (relname like 'marketing\\_%' or relname = 'newsletter_subscribers')`,
    );

    expect(rows.length).toBeGreaterThanOrEqual(CONTENT_TABLES.length + 1);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} must enable RLS`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} must force RLS`).toBe(true);
    }
  });

  it("lets an anonymous reader see published marketing content", async () => {
    await assumeRole(db, "anon");
    const { rows } = await db.query<{ slug: string }>(
      "select slug from public.marketing_pages order by sort_order",
    );

    expect(rows.map((row) => row.slug)).toEqual([
      "home", "platform", "features", "solutions", "pricing", "resources", "about",
    ]);
  });

  it("hides unpublished rows from anonymous and authenticated readers alike", async () => {
    await resetRole(db);
    await db.exec("update public.marketing_pages set published = false where slug = 'about'");

    for (const role of ["anon", "authenticated"] as const) {
      await assumeRole(db, role);
      const { rows } = await db.query<{ count: number }>(
        "select count(*)::int as count from public.marketing_pages where slug = 'about'",
      );
      expect(rows[0].count, `${role} must not see unpublished content`).toBe(0);
    }

    await resetRole(db);
    await db.exec("update public.marketing_pages set published = true where slug = 'about'");
  });

  it.each(CONTENT_TABLES)("refuses anonymous writes to %s", async (table) => {
    await assumeRole(db, "anon");

    const insertError = await rejects(() =>
      db.exec(`insert into public.${table} default values`),
    );
    const updateError = await rejects(() => db.exec(`update public.${table} set published = false`));
    const deleteError = await rejects(() => db.exec(`delete from public.${table}`));

    for (const message of [insertError, updateError, deleteError]) {
      expect(message).toMatch(/permission denied|denied for/i);
    }
  });

  it("refuses authenticated writes too — content is not a tenant surface", async () => {
    await assumeRole(db, "authenticated");

    const message = await rejects(() =>
      db.exec("insert into public.marketing_logos (name, wordmark) values ('X', 'X')"),
    );
    expect(message).toMatch(/permission denied|denied for/i);
  });

  it("never lets a browser role read subscriber rows", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await assumeRole(db, role);
      const message = await rejects(() =>
        db.query("select email from public.newsletter_subscribers"),
      );
      expect(message, `${role} must not read subscribers`).toMatch(/permission denied|denied for/i);
    }
  });

  it("accepts a subscription through the function and normalizes the address", async () => {
    await assumeRole(db, "anon");
    const { rows } = await db.query<{ subscribe_to_newsletter: string }>(
      "select public.subscribe_to_newsletter($1, $2)",
      ["  Reader@Example.COM ", "resources"],
    );
    expect(rows[0].subscribe_to_newsletter).toBe("subscribed");

    await resetRole(db);
    const stored = await db.query<{ email: string; source: string }>(
      "select email, source from public.newsletter_subscribers",
    );
    expect(stored.rows).toEqual([{ email: "reader@example.com", source: "resources" }]);
  });

  it("is idempotent per address and answers identically, so it cannot enumerate", async () => {
    await assumeRole(db, "anon");
    const first = await db.query<{ subscribe_to_newsletter: string }>(
      "select public.subscribe_to_newsletter($1)",
      ["repeat@example.com"],
    );
    const second = await db.query<{ subscribe_to_newsletter: string }>(
      "select public.subscribe_to_newsletter($1)",
      ["repeat@example.com"],
    );

    expect(first.rows[0].subscribe_to_newsletter).toBe("subscribed");
    expect(second.rows[0].subscribe_to_newsletter).toBe(first.rows[0].subscribe_to_newsletter);

    await resetRole(db);
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from public.newsletter_subscribers where email = 'repeat@example.com'",
    );
    expect(rows[0].count).toBe(1);
  });

  it("rejects a malformed address inside the database, not only in the route", async () => {
    await assumeRole(db, "anon");

    for (const candidate of ["", "   ", "not-an-email", "missing@tld", "a@b.c"]) {
      const message = await rejects(() =>
        db.query("select public.subscribe_to_newsletter($1)", [candidate]),
      );
      expect(message, `${candidate} must be rejected`).toMatch(/valid email address is required/i);
    }
  });

  it("falls back to a safe source rather than storing an arbitrary one", async () => {
    await assumeRole(db, "anon");
    await db.query("select public.subscribe_to_newsletter($1, $2)", [
      "sourced@example.com",
      "NOT A VALID SOURCE!!",
    ]);

    await resetRole(db);
    const { rows } = await db.query<{ source: string }>(
      "select source from public.newsletter_subscribers where email = 'sourced@example.com'",
    );
    expect(rows[0].source).toBe("resources");
  });

  it("holds the HTTPS and shape constraints the application relies on", async () => {
    await resetRole(db);

    await expect(
      db.exec("insert into public.marketing_team_members (name, role, bio, linkedin_url) values ('A','B','C','http://insecure.example')"),
    ).rejects.toThrow();
    await expect(
      db.exec("insert into public.marketing_pages (slug, headline, seo_title, seo_description) values ('Not A Slug','h','t','d')"),
    ).rejects.toThrow();
  });
});
