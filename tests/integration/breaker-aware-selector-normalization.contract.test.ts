// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migrationPath = resolve(
  root,
  "supabase/migrations/20260828000050_normalize_breaker_aware_phase1c_selector.sql",
);
const stalePath = resolve(
  root,
  "supabase/migrations/20260815000300_phase2e_portfolio_scheduler.sql",
);
const targetPath = resolve(
  root,
  "supabase/migrations/20260815000500_phase2e_breaker_aware_scheduling.sql",
);

let migration = "";
let stale = "";
let target = "";

function selectorBody(source: string) {
  const marker =
    "create or replace function public.claim_phase1c_run_budget_internal(";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("selector definition is missing");
  const remainder = source.slice(start);
  const opening = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(remainder);
  if (!opening?.[1] || opening.index === undefined) {
    throw new Error("selector body delimiter is missing");
  }
  const delimiter = opening[1];
  const delimiterStart = remainder.indexOf(delimiter, opening.index);
  const bodyStart = delimiterStart + delimiter.length;
  const bodyEnd = remainder.indexOf(delimiter, bodyStart);
  if (bodyEnd < 0) throw new Error("selector body is unterminated");
  return remainder.slice(bodyStart, bodyEnd).replace(/\r\n?/g, "\n");
}

function md5(value: string) {
  return createHash("md5").update(value).digest("hex");
}

beforeAll(async () => {
  [migration, stale, target] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(stalePath, "utf8"),
    readFile(targetPath, "utf8"),
  ]);
});

describe("breaker-aware Phase 1C selector normalization", () => {
  it("moves only the exact stale selector onto the byte-exact reviewed body", () => {
    expect(md5(selectorBody(stale))).toBe("ed5840b9d8d0efdb513a8576df128e9b");
    expect(md5(selectorBody(target))).toBe("5933952d71f9da90a2a80a05ce6e0378");
    expect(selectorBody(migration)).toBe(selectorBody(target));
    expect(selectorBody(migration)).not.toBe(selectorBody(stale));
  });

  it("accepts only the known clean or hosted source and preserves the full ABI", () => {
    for (const evidence of [
      "ed5840b9d8d0efdb513a8576df128e9b",
      "5933952d71f9da90a2a80a05ce6e0378",
      "0e52321dcc4ae192741cff672f3b9abb",
      "b511c642748a410371daffa5975dfc95",
      "6dd487ee94c50b0250bdca6bfdacac71",
      "routine.proparallel = 'u'",
      "not routine.proisstrict",
      "not routine.proleakproof",
      "routine.pronargdefaults = 1",
      "routine.prosecdef",
      "search_path=pg_catalog",
      "pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'",
      "pg_catalog.aclexplode(routine.proacl)",
    ]) {
      expect(migration).toContain(evidence);
    }
  });

  it("pins every breaker dependency without rewriting it", () => {
    for (const evidence of [
      "9b46c6e078158e2f2ac1be0126e47e65",
      "ce7c51ad47992174634c960b8a8faaaf",
      "41323ace6fed5d3e5ebc512464bd358d",
      "resource_breakers_target_unique",
      "resource_breakers_open_is_explained",
      "resource_breakers_closed_is_clean",
      "resource_breakers_select_members",
      "relation.relrowsecurity",
      "relation.relforcerowsecurity",
      "f3b72bb359a50b640590970a2ab8e514",
      "032cd0831e00bde5d89d95eeb9528422",
      "75230039beb12ce952f24927f2bfa2f2",
      "04012ad5d4aa2f1b2ad25b2451e653f0",
      "3c702b28ccc97a0ac52c0acefcdea477",
      "3f2b58d9d0290fe4b4398322f617a246",
      "415d827b30b8846fb40447bd1d968b3e",
      "2eea03a91826969e8abc25f7f80097f6",
      "pg_catalog.aclexplode(relation_row.relacl)",
      "actual.grantee not in",
      "pg_catalog.acldefault('r', relation_row.relowner)",
      "attribute.attacl is not null",
      "not index_row.indisvalid",
      "not index_row.indisready",
      "not index_row.indislive",
      "authenticated_expected(privilege_type) as (",
      "values ('SELECT')",
      "breaker-aware selector base overload count drifted",
    ]) {
      expect(migration).toContain(evidence);
    }
    expect(migration).not.toContain("pg_catalog.strpos(");
    expect(migration).not.toMatch(
      /create or replace function public\.(?:breaker_cooldown_seconds|breaker_suppression_reason|consume_breaker_trial)\(/i,
    );
  });

  it("keeps the selector private and never repairs historical ledger rows", () => {
    expect(migration).toMatch(
      /revoke all on function public\.claim_phase1c_run_budget_internal\([\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(migration).not.toMatch(/grant execute on function/i);
    expect(migration).not.toMatch(/migration\s+repair/i);
    expect(migration).not.toMatch(/supabase_migrations\.schema_migrations/i);
    expect(migration).toContain("target-bound selector catalog already exists");
  });
});
