// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const onboardingMigration = readFileSync(
  resolve(
    repositoryRoot,
    "supabase/migrations/20260812000500_authenticated_onboarding.sql",
  ),
  "utf8",
);
const allMigrations = [
  "20260812000100_control_plane_schema.sql",
  "20260812000200_row_level_security.sql",
  "20260812000300_control_plane_workflows.sql",
  "20260812000500_authenticated_onboarding.sql",
]
  .map((file) =>
    readFileSync(resolve(repositoryRoot, "supabase/migrations", file), "utf8"),
  )
  .join("\n");

describe("authenticated Supabase onboarding contract", () => {
  it("derives identity only from auth.uid and accepts no caller user id", () => {
    expect(onboardingMigration).toMatch(
      /function\s+public\.onboard_authenticated_organization\(\s*p_name\s+text,\s*p_slug\s+text/i,
    );
    expect(onboardingMigration).toMatch(/caller_id\s+uuid\s*:=\s*auth\.uid\(\)/i);
    expect(onboardingMigration).not.toMatch(/p_(?:user|owner|created_by)_id/i);
  });

  it("is a narrowly granted SECURITY DEFINER RPC", () => {
    expect(onboardingMigration).toMatch(/security\s+definer/i);
    expect(onboardingMigration).toMatch(/set\s+search_path\s*=\s*pg_catalog/i);
    expect(onboardingMigration).toMatch(
      /revoke\s+all\s+on\s+function[\s\S]+from\s+public,\s*anon/i,
    );
    expect(onboardingMigration).toMatch(
      /grant\s+execute\s+on\s+function[\s\S]+to\s+authenticated/i,
    );
    expect(onboardingMigration).not.toMatch(/\bservice_role\b/i);
  });

  it("keeps onboarding tables under enabled and forced RLS", () => {
    for (const table of ["profiles", "organizations", "organization_members"]) {
      expect(allMigrations).toMatch(
        new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
      );
      expect(allMigrations).toMatch(
        new RegExp(`alter\\s+table\\s+public\\.${table}\\s+force\\s+row\\s+level\\s+security`, "i"),
      );
    }
    expect(allMigrations).not.toMatch(/disable\s+row\s+level\s+security/i);
  });

  it("creates owner membership and immutable organization audit evidence", () => {
    expect(allMigrations).toMatch(
      /bootstrap_organization_owner_after_insert[\s\S]+on\s+public\.organizations/i,
    );
    expect(allMigrations).toMatch(
      /organizations_audit_created[\s\S]+on\s+public\.organizations/i,
    );
    expect(allMigrations).toMatch(
      /activity_events_append_only[\s\S]+before\s+update\s+or\s+delete/i,
    );
    expect(onboardingMigration).toMatch(
      /membership_role\s+is\s+distinct\s+from\s+'owner'/i,
    );
  });

  it("is additive and contains no destructive data operation", () => {
    expect(onboardingMigration).not.toMatch(
      /\b(?:drop\s+(?:table|schema|type)|truncate|delete\s+from)\b/i,
    );
  });

  it("serializes same-slug retries for deterministic onboarding", () => {
    expect(onboardingMigration).toMatch(
      /pg_advisory_xact_lock\([\s\S]+hashtextextended\(normalized_slug,\s*0\)/i,
    );
  });
});
