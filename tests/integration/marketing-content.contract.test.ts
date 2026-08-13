// @vitest-environment node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MARKETING_PAGES, MARKETING_PLANS } from "@/lib/marketing/content";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

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

function readMarketingMigration(): string {
  expect(existsSync(migrationsDirectory), "supabase/migrations must exist").toBe(true);
  const file = readdirSync(migrationsDirectory).find((entry) =>
    entry.endsWith(".sql") && entry.includes("marketing_content"),
  );
  expect(file, "the marketing content migration must exist").toBeDefined();
  return readFileSync(resolve(migrationsDirectory, file as string), "utf8");
}

const sql = readMarketingMigration();

describe("marketing content migration", () => {
  it("creates every table the content layer reads", () => {
    for (const table of [...CONTENT_TABLES, "newsletter_subscribers"]) {
      expect(sql).toMatch(new RegExp(`create\\s+table\\s+public\\.${table}\\s*\\(`, "i"));
    }
  });

  it("enables and forces row level security on every table it adds", () => {
    // Applied through a loop, so assert the loop covers each table by name.
    for (const table of [...CONTENT_TABLES, "newsletter_subscribers"]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toMatch(/enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/force\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security/i);
  });

  it("publishes marketing copy to anonymous readers only when it is published", () => {
    expect(sql).toMatch(
      /create\s+policy\s+%I\s+on\s+public\.%I\s+for\s+select\s+to\s+anon,\s*authenticated\s+using\s*\(published\)/i,
    );
    expect(sql).toMatch(/grant\s+select\s+on\s+table\s+public\.%I\s+to\s+anon,\s*authenticated/i);
  });

  it("never grants a browser a write path to marketing content", () => {
    expect(sql).not.toMatch(/grant[^;]*\b(insert|update|delete)\b[^;]*to\s+(anon|authenticated)/i);
    expect(sql).not.toMatch(/for\s+(insert|update|delete)\s+to\s+(anon|authenticated)/i);
  });

  it("keeps subscriber rows unreadable from a browser", () => {
    // The subscriber table is deliberately excluded from the SELECT-policy loop.
    const loopStart = sql.indexOf("Published marketing content is public by design");
    const selectLoop = sql.slice(loopStart, sql.indexOf("$marketing_triggers$;", loopStart));
    expect(selectLoop).toContain("marketing_pages");
    expect(selectLoop).not.toContain("newsletter_subscribers");
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+public\.%I\s+from\s+anon,\s*authenticated/i,
    );
  });

  it("accepts public input only through the validating function", () => {
    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.subscribe_to_newsletter\([\s\S]*?security\s+definer/i,
    );
    expect(sql).toMatch(/set\s+search_path\s*=\s*pg_catalog/i);
    expect(sql).toMatch(/on\s+conflict\s*\(email\)\s*do\s+nothing/i);
    expect(sql).toMatch(/return\s+'subscribed'/i);
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.subscribe_to_newsletter\(text,\s*text\)\s+to\s+anon,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.subscribe_to_newsletter\(text,\s*text\)\s+from\s+public/i,
    );
  });

  it("validates the email address inside the trusted boundary, not only in the route", () => {
    expect(sql).toMatch(/a valid email address is required/);
    expect(sql).toMatch(/\^\[a-z0-9\._%\+-\]\+@/);
    expect(sql).toMatch(/public\.text_has_likely_secret\(normalized_email\)/);
  });

  it("attaches the sensitive-data guard so content cannot carry credentials", () => {
    expect(sql).toMatch(/public\.reject_sensitive_row_data\(\)/);
    expect(sql).toMatch(/public\.set_updated_at\(\)/);
  });

  it("does not reference any tenant table", () => {
    for (const tenantTable of ["organizations", "projects", "connections", "bots", "auth.users"]) {
      expect(sql).not.toContain(`public.${tenantTable}(`);
    }
    expect(sql).not.toMatch(/organization_id/);
  });
});

describe("seed parity between the migration and the fallback", () => {
  it("seeds the same page slugs the fallback declares", () => {
    const seeded = [...sql.matchAll(/^\s*\('([a-z-]+)',\s*'[^']*',\n/gm)].map((match) => match[1]);
    const pageSection = sql.slice(
      sql.indexOf("insert into public.marketing_pages"),
      sql.indexOf("insert into public.marketing_stats"),
    );

    for (const page of MARKETING_PAGES) {
      expect(pageSection, `migration must seed the ${page.slug} page`).toContain(`('${page.slug}',`);
    }
    expect(seeded.length).toBeGreaterThan(0);
  });

  it("seeds the same pricing plans, prices and highlight as the fallback", () => {
    const planSection = sql.slice(
      sql.indexOf("insert into public.marketing_pricing_plans"),
      sql.indexOf("insert into public.marketing_plan_features"),
    );

    for (const plan of MARKETING_PLANS) {
      expect(planSection).toContain(`('${plan.slug}', '${plan.name}'`);
      if (plan.monthlyPriceCents !== null) {
        expect(planSection, `${plan.slug} monthly price must match`).toContain(
          `${plan.monthlyPriceCents}, ${plan.yearlyPriceCents}`,
        );
      }
    }

    const highlighted = MARKETING_PLANS.filter((plan) => plan.highlighted);
    expect(highlighted).toHaveLength(1);
    expect(planSection).toContain(`'${highlighted[0].highlightLabel}'`);
  });

  it("seeds every comparison-matrix row the fallback renders", () => {
    const featureSection = sql.slice(sql.indexOf("insert into public.marketing_plan_features"));
    const rows = new Set(
      MARKETING_PLANS.flatMap((plan) =>
        plan.features.flatMap((feature) => (feature.matrixRow ? [feature.matrixRow] : [])),
      ),
    );

    for (const row of rows) {
      expect(featureSection, `migration must seed matrix row ${row}`).toContain(`'${row}'`);
    }
  });
});
