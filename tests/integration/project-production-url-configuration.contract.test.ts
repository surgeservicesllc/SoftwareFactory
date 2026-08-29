// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260828000100_project_production_url_configuration.sql",
);

describe("project production URL migration contract", () => {
  it("keeps the old detail RPC intact and adds one pinned owner-safe writer", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).not.toMatch(/create\s+or\s+replace\s+function\s+public\.update_project_details/i);
    expect(migration).toContain(
      "to_regprocedure('public.update_project_details(uuid,text,text)')",
    );
    expect(migration).toMatch(
      /create or replace function public\.set_project_production_url\(\s*p_organization_id uuid,\s*p_project_id uuid,\s*p_production_url text\s*\)[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(migration).toMatch(/auth\.uid\(\)/i);
    expect(migration).toMatch(/public\.can_manage_organization\(project_record\.organization_id\)/i);
    expect(migration).toMatch(/project_record\.status = 'archived'/i);
  });

  it("enforces a public HTTPS target and preserves forced RLS plus audit", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toMatch(/position\('\?' in candidate\) > 0/i);
    expect(migration).toMatch(/position\('#' in candidate\) > 0/i);
    expect(migration).toMatch(/position\('@' in authority\) > 0/i);
    expect(migration).toMatch(/public\.text_has_likely_secret\(candidate\)/i);
    expect(migration).toMatch(/localhost\|local\|internal\|lan\|home/i);
    expect(migration).toMatch(/169[\s\S]*254/i);
    expect(migration).toMatch(/172[\s\S]*between 16 and 31/i);
    expect(migration).toMatch(/192[\s\S]*168/i);
    expect(migration).toMatch(/projects_production_url_public_https/i);
    expect(migration).toMatch(/projects RLS must remain enabled and forced/i);
    expect(migration).toMatch(/trigger_row\.tgenabled = 'O'/i);
    expect(migration).toMatch(
      /trigger_row\.tgfoid = 'public\.audit_project_change\(\)'::regprocedure/i,
    );
    expect(migration).toMatch(/trigger_row\.tgtype = 21/i);
    expect(migration).toMatch(/projects_audit_change exact metadata must remain unchanged/i);
  });

  it("grants only authenticated callers and never widens a worker role", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toMatch(
      /revoke all on function public\.set_project_production_url\(uuid, uuid, text\)\s+from public, anon, service_role;/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.set_project_production_url\(uuid, uuid, text\)\s+to authenticated;/i,
    );
    expect(migration).not.toMatch(/grant execute[\s\S]{0,160}service_role/i);
    expect(migration).not.toMatch(/autonomous_mode\s*=\s*true|auto_deploy\s*=\s*true/i);
  });
});
