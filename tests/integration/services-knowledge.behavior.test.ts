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
 * What people look up (ADR-237) against the real chain: an article is a
 * member's row under RLS with a slug the schema shapes; the search scores
 * by arithmetic it prints; the customer reads published customer articles
 * of their own workspace and nothing else; and a booked visit hands over
 * what a calendar entry needs, only to the account it belongs to.
 */

const acmeOwner = "00000000-0000-4000-8000-000000037001";
const rivalOwner = "00000000-0000-4000-8000-000000037002";
const portalUser = "00000000-0000-4000-8000-000000037003";
const acmeOrg = "10000000-0000-4000-8000-000000037001";
const rivalOrg = "10000000-0000-4000-8000-000000037002";

describe("knowledge base, portal articles and the visit calendar", { timeout: 240_000 }, () => {
  let db: PGlite;
  let harborview = ""; let harborviewSite = ""; let bookedVisit = ""; let otherVisit = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function rejects(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("expected the statement to be rejected");
  }

  async function article(org: string, by: string, fields: { slug: string; title: string; body: string; audience: "staff" | "customer"; published: boolean; category?: string }) {
    return (await db.query<{ id: string }>(
      `insert into public.crm_kb_articles (organization_id, slug, title, body, category, audience, published_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, case when $7 then now() else null end, $8, $8) returning id`,
      [org, fields.slug, fields.title, fields.body, fields.category ?? null, fields.audience, fields.published, by],
    )).rows[0].id;
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
    const migrationFiles = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
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
      insert into auth.users (id, email) values
        ('${acmeOwner}', 'owner@acme.example'), ('${rivalOwner}', 'owner@rival.example'),
        ('${portalUser}', 'dana@harborview.example');
      insert into public.organizations (id, name, slug, created_by)
      values ('${acmeOrg}', 'Acme Pest', 'acme-pest-knowledge', '${acmeOwner}'),
             ('${rivalOrg}', 'Rival Pest', 'rival-pest-knowledge', '${rivalOwner}');
    `);
    await as(acmeOwner);
    harborview = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    harborviewSite = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Plant', '1 Loaf Lane, Harbor City') returning id`, [acmeOrg, harborview])).rows[0].id;
    const other = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Old Mill', 'residential', 'customer', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    const otherSite = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Home', '9 Mill Road') returning id`, [acmeOrg, other])).rows[0].id;
    const rosa = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Rosa', 'Vega', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    const visit = async (account: string, property: string) => (await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, service_type, scheduled_start, scheduled_end, status, created_by)
       values ($1, $2, $3, $4, 'General pest', '2026-10-05T14:00:00Z', '2026-10-05T15:30:00Z', 'scheduled', $5)
       returning id`, [acmeOrg, account, property, rosa, acmeOwner])).rows[0].id;
    bookedVisit = await visit(harborview, harborviewSite);
    otherVisit = await visit(other, otherSite);

    // The portal user attaches themselves (the guard trigger insists).
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [portalUser]);
    await db.query(
      `insert into public.crm_portal_users (organization_id, account_id, user_id, email, activated_at, created_by)
       values ($1, $2, $3, 'dana@harborview.example', now(), $4)`,
      [acmeOrg, harborview, portalUser, acmeOwner]);

    await as(acmeOwner);
    await article(acmeOrg, acmeOwner, { slug: "ant-treatment-what-to-expect", title: "Ant treatment: what to expect", audience: "customer", published: true, category: "Before your visit",
      body: "Please clear the counters before we arrive. We place bait where the ants trail, and it can take ten days for the colony to stop." });
    await article(acmeOrg, acmeOwner, { slug: "rodent-stations-on-commercial-sites", title: "Rodent stations on commercial sites", audience: "customer", published: true, category: "Commercial",
      body: "Stations are numbered and checked on every visit. Bait is locked inside; do not move a station." });
    await article(acmeOrg, acmeOwner, { slug: "calling-back-a-complaint", title: "Calling back a complaint", audience: "staff", published: true, category: "Service",
      body: "Call within two hours. Read the request first, then the last visit note." });
    await article(acmeOrg, acmeOwner, { slug: "termite-pretreatment", title: "Termite pretreatment", audience: "customer", published: false,
      body: "Draft: the slab is treated before the pour." });
    await as(rivalOwner);
    await article(rivalOrg, rivalOwner, { slug: "ant-treatment-what-to-expect", title: "Ant treatment", audience: "customer", published: true,
      body: "The rival's own ant page, with the same slug in a different workspace." });
  });

  afterAll(async () => { await db?.close(); });

  it("fences the table and grants the functions to authenticated only, with the customer read as a definer", async () => {
    await db.exec("reset role");
    const fence = (await db.query<{ rls: boolean; forced: boolean }>(
      `select c.relrowsecurity as rls, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'crm_kb_articles'`)).rows[0];
    expect(fence).toEqual({ rls: true, forced: true });
    const grants = (await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'crm_kb_articles' and grantee in ('anon', 'authenticated', 'service_role')
        order by 1, 2`)).rows;
    expect(grants).toEqual([
      { grantee: "authenticated", privilege_type: "DELETE" },
      { grantee: "authenticated", privilege_type: "INSERT" },
      { grantee: "authenticated", privilege_type: "SELECT" },
      { grantee: "authenticated", privilege_type: "UPDATE" },
    ]);
    const functions = (await db.query<{ name: string; definer: boolean; anon: boolean; authenticated: boolean; service: boolean }>(
      `select p.proname as name, p.prosecdef as definer,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('crm_kb_terms', 'crm_kb_search', 'crm_portal_articles', 'crm_portal_visit_calendar')
        order by 1`)).rows;
    expect(functions).toEqual([
      { name: "crm_kb_search", definer: false, anon: false, authenticated: true, service: false },
      { name: "crm_kb_terms", definer: false, anon: false, authenticated: true, service: false },
      { name: "crm_portal_articles", definer: true, anon: false, authenticated: true, service: false },
      { name: "crm_portal_visit_calendar", definer: true, anon: false, authenticated: true, service: false },
    ]);
  });

  it("shapes the slug, keeps it unique per workspace, and refuses a secret in the text", async () => {
    await as(acmeOwner);
    expect(await rejects(() => article(acmeOrg, acmeOwner, { slug: "Bad Slug", title: "x y", body: "b", audience: "staff", published: false })))
      .toMatch(/crm_kb_articles_slug_check/);
    expect(await rejects(() => article(acmeOrg, acmeOwner, { slug: "ant-treatment-what-to-expect", title: "Again", body: "b", audience: "staff", published: false })))
      .toMatch(/crm_kb_articles_org_slug_key/);
    expect(await rejects(() => article(acmeOrg, acmeOwner, { slug: "leak", title: "Leak", body: "Use bearer abcdefghijklmnopqrstuvwxyz0123 to pay", audience: "staff", published: false })))
      .toMatch(/crm_kb_articles_body_no_secret/);
    // The rival's article with the same slug exists: uniqueness is per workspace.
    const rivalRows = (await db.query<{ n: string }>(`select count(*) as n from public.crm_kb_articles where slug = 'ant-treatment-what-to-expect'`)).rows[0];
    expect(Number(rivalRows.n)).toBe(1); // as the acme owner, only acme's row is visible
  });

  it("scores by the words that hit — three for the title, one for the body — and prints the arithmetic", async () => {
    await as(acmeOwner);
    const bait = (await db.query<{ slug: string; rank: number; title_hits: number; body_hits: number; excerpt: string }>(
      `select slug, rank, title_hits, body_hits, excerpt from public.crm_kb_search($1, $2)`, [acmeOrg, "bait"])).rows;
    expect(bait.map((row) => [row.slug, row.rank, row.title_hits, row.body_hits])).toEqual([
      ["rodent-stations-on-commercial-sites", 1, 0, 1],
      ["ant-treatment-what-to-expect", 1, 0, 1],
    ]);
    expect(bait[0].excerpt).toContain("Bait is locked inside");

    const rodent = (await db.query<{ slug: string; rank: number; title_hits: number; body_hits: number }>(
      `select slug, rank, title_hits, body_hits from public.crm_kb_search($1, $2)`, [acmeOrg, "rodent stations"])).rows;
    expect(rodent.map((row) => [row.slug, row.rank, row.title_hits, row.body_hits])).toEqual([
      ["rodent-stations-on-commercial-sites", 7, 2, 1],
    ]);

    // Stop words and short words count nothing: the question and the word give the same answer.
    const asked = (await db.query<{ slug: string; rank: number }>(
      `select slug, rank from public.crm_kb_search($1, $2)`, [acmeOrg, "What do we tell customers about the bait?"])).rows;
    expect(asked.map((row) => [row.slug, row.rank])).toEqual(bait.map((row) => [row.slug, row.rank]));
    expect((await db.query<{ term: string }>(`select term from public.crm_kb_terms($1) term order by 1`, ["What do we tell customers about the bait?"])).rows.map((row) => row.term)).toEqual(["bait"]);

    // No words: everything, rank 0, drafts included; the filters narrow it.
    const all = (await db.query<{ slug: string; rank: number }>(`select slug, rank from public.crm_kb_search($1, null)`, [acmeOrg])).rows;
    expect(all).toHaveLength(4);
    expect(all.every((row) => row.rank === 0)).toBe(true);
    expect((await db.query(`select 1 from public.crm_kb_search($1, null, 'customer')`, [acmeOrg])).rows).toHaveLength(3);
    expect((await db.query(`select 1 from public.crm_kb_search($1, null, 'customer', true)`, [acmeOrg])).rows).toHaveLength(2);
    expect((await db.query(`select 1 from public.crm_kb_search($1, 'colony')`, [acmeOrg])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from public.crm_kb_search($1, 'nothing-here')`, [acmeOrg])).rows).toHaveLength(0);

    // A rival asking about acme's workspace gets nothing: RLS, not the function, decides.
    await as(rivalOwner);
    expect((await db.query(`select 1 from public.crm_kb_search($1, null)`, [acmeOrg])).rows).toHaveLength(0);
    // And a portal user is not a member, so the member search shows them nothing either.
    await as(portalUser);
    expect((await db.query(`select 1 from public.crm_kb_search($1, null)`, [acmeOrg])).rows).toHaveLength(0);
  });

  it("gives the customer only published, customer-audience articles of their own workspace, with the body", async () => {
    await as(portalUser);
    const mine = (await db.query<{ slug: string; rank: number; body: string; category: string | null }>(
      `select slug, rank, body, category from public.crm_portal_articles()`)).rows;
    expect(mine.map((row) => row.slug).sort()).toEqual(["ant-treatment-what-to-expect", "rodent-stations-on-commercial-sites"]);
    expect(mine.find((row) => row.slug === "ant-treatment-what-to-expect")?.body).toContain("clear the counters");
    const rodent = (await db.query<{ slug: string; rank: number; excerpt: string }>(
      `select slug, rank, excerpt from public.crm_portal_articles($1)`, ["station"])).rows;
    expect(rodent.map((row) => [row.slug, row.rank])).toEqual([["rodent-stations-on-commercial-sites", 4]]);
    // A member who is not a portal user resolves to no account, and so to no articles.
    await as(acmeOwner);
    expect((await db.query(`select 1 from public.crm_portal_articles()`)).rows).toHaveLength(0);
  });

  it("hands over one booked visit's calendar facts to the account it belongs to, and no row otherwise", async () => {
    await as(portalUser);
    const own = (await db.query<{ service_type: string; scheduled_start: string; scheduled_end: string; property_label: string; address: string; technician_name: string; organization_name: string }>(
      `select service_type, scheduled_start, scheduled_end, property_label, address, technician_name, organization_name
         from public.crm_portal_visit_calendar($1)`, [bookedVisit])).rows;
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      service_type: "General pest", property_label: "Plant", address: "1 Loaf Lane, Harbor City",
      technician_name: "Rosa Vega", organization_name: "Acme Pest",
    });
    expect(new Date(own[0].scheduled_start).toISOString()).toBe("2026-10-05T14:00:00.000Z");
    expect(new Date(own[0].scheduled_end).toISOString()).toBe("2026-10-05T15:30:00.000Z");
    expect((await db.query(`select 1 from public.crm_portal_visit_calendar($1)`, [otherVisit])).rows).toHaveLength(0);
    await as(acmeOwner);
    expect((await db.query(`select 1 from public.crm_portal_visit_calendar($1)`, [bookedVisit])).rows).toHaveLength(0);
  });
});
