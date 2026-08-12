// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(
    repositoryRoot,
    "supabase/migrations/20260812001100_harden_direct_mutation_boundaries.sql",
  ),
  "utf8",
);

describe("direct mutation boundary hardening", () => {
  it("removes direct authenticated connection deletion", () => {
    expect(migration).toMatch(
      /drop policy if exists connections_delete_owners on public\.connections/i,
    );
    expect(migration).toMatch(
      /revoke delete on table public\.connections from authenticated/i,
    );
  });

  it("removes unaudited direct organization membership writes", () => {
    for (const policy of [
      "organization_members_insert_managers",
      "organization_members_update_managers",
      "organization_members_delete_owners",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `drop policy if exists ${policy} on public\\.organization_members`,
          "i",
        ),
      );
    }

    expect(migration).toMatch(
      /revoke insert, update, delete on table public\.organization_members from authenticated/i,
    );
  });

  it("preserves only the audited authenticated onboarding entry point", () => {
    expect(migration).toMatch(
      /grant execute on function public\.onboard_authenticated_organization\(text, text\)\s+to authenticated/i,
    );
    expect(migration).not.toMatch(/drop\s+function/i);
    expect(migration).not.toMatch(/drop\s+table/i);
    expect(migration).not.toMatch(/disable\s+row\s+level\s+security/i);
  });

  it("detects GitHub fine-grained personal access tokens", () => {
    expect(migration).toMatch(/github_pat_\[A-Za-z0-9_\]\{20,\}/);
    expect(migration).toMatch(
      /create or replace function public\.text_has_likely_secret\(input_text text\)/i,
    );
  });
});
