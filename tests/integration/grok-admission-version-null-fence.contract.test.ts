// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260831001900_grok_admission_version_null_fence.sql",
);

describe("Grok admission version null fence", () => {
  let sql: string;
  let route: string;
  let store: string;

  beforeAll(async () => {
    [sql, route, store] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(resolve(import.meta.dirname, "../../app/api/grok/sessions/route.ts"), "utf8"),
      readFile(resolve(import.meta.dirname, "../../lib/grok/session-store.ts"), "utf8"),
    ]);
  });

  it("rejects null, missing, and wrong roster or execution protocol versions", () => {
    expect(sql).toContain("entry.value ->> 'version' is distinct from '1'");
    expect(sql).toContain("admission.value ->> 'version' is distinct from '2'");
    expect(sql).not.toMatch(/->>\s*'version'\s*<>/i);
    expect(sql).toContain("pg_catalog.jsonb_typeof(entry.value) is distinct from 'object'");
    expect(sql).toContain("pg_catalog.jsonb_typeof(admission.value) is distinct from 'object'");
  });

  it("wraps the prior audited boundaries before they can write", () => {
    for (const name of [
      "record_grok_specialist_roster_v2_as_server",
      "launch_grok_full_lifecycle_v4_as_server",
      "launch_grok_read_only_research_v2_as_server",
    ]) {
      expect(sql).toMatch(new RegExp(
        `create function public\\.${name}\\([\\s\\S]*?security definer\\s+set search_path = pg_catalog`,
        "i",
      ));
    }
    expect(sql.indexOf("entry.value ->> 'version' is distinct from '1'"))
      .toBeLessThan(sql.indexOf("return public.record_grok_specialist_roster_v1_as_server("));
    expect(sql.indexOf("admission.value ->> 'version' is distinct from '2'"))
      .toBeLessThan(sql.indexOf("return public.launch_grok_full_lifecycle_v3_as_server("));
    expect(sql).not.toMatch(/insert\s+into\s+public\./i);
  });

  it("leaves only the fenced overloads callable by service_role", () => {
    for (const legacy of [
      "record_grok_specialist_roster_v1_as_server",
      "launch_grok_full_lifecycle_v3_as_server",
      "launch_grok_read_only_research_v1_as_server",
    ]) {
      expect(sql).toMatch(new RegExp(
        `revoke all on function public\\.${legacy}\\([\\s\\S]*?from public, anon, authenticated, service_role;`,
        "i",
      ));
    }
    for (const current of [
      "record_grok_specialist_roster_v2_as_server",
      "launch_grok_full_lifecycle_v4_as_server",
      "launch_grok_read_only_research_v2_as_server",
    ]) {
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${current}\\([\\s\\S]*?to service_role;`,
        "i",
      ));
      expect(sql).not.toMatch(new RegExp(
        `grant execute on function public\\.${current}\\([\\s\\S]*?to (?:public|anon|authenticated);`,
        "i",
      ));
    }
  });

  it("routes every browser request through the fenced names", () => {
    expect(store).toContain('"record_grok_specialist_roster_v2_as_server"');
    expect(route).toContain('"launch_grok_full_lifecycle_v4_as_server"');
    expect(route).toContain('"launch_grok_read_only_research_v2_as_server"');
    expect(route).toContain('"full_lifecycle_v4"');
    expect(route).toContain('"read_only_research_v2"');
    expect(route).not.toContain('"launch_grok_full_lifecycle_v3_as_server"');
    expect(route).not.toContain('"launch_grok_read_only_research_v1_as_server"');
    expect(route).not.toContain('"full_lifecycle_v3"');
    expect(route).not.toContain('"read_only_research_v1"');
  });
});
