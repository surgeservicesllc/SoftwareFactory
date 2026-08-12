// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

const listRoutes = [
  { name: "agents", path: "app/api/agents/route.ts", table: "agents" },
  { name: "tasks", path: "app/api/tasks/route.ts", table: "tasks" },
  { name: "runs", path: "app/api/runs/route.ts", table: "agent_runs" },
  { name: "reports", path: "app/api/reports/route.ts", table: "reports" },
  { name: "commands", path: "app/api/commands/route.ts", table: "commands" },
] as const;

describe("tenant list boundary", () => {
  const helper = read("lib/server/tenant-list.ts");

  it("is server-only and reads through the caller's session so RLS applies", () => {
    expect(helper).toContain('import "server-only"');
    expect(helper).toMatch(/requireActiveOrganization\(\)/);
    // A service-role client would bypass RLS; these routes must never use one.
    expect(helper).not.toMatch(/service.?role/i);
    expect(helper).not.toMatch(/createSupabaseServiceRoleClient/);
  });

  it("scopes every read to the exact active organization", () => {
    expect(helper).toMatch(/\.eq\("organization_id", context\.activeOrganization\.id\)/);
  });

  it("bounds the row count and never caches a tenant response", () => {
    expect(helper).toMatch(/\.max\(100\)/);
    expect(helper).toMatch(/\.limit\(parsed\.data\.limit\)/);
    expect(helper).toMatch(/jsonNoStore/);
  });

  it("scopes referenced-name lookups to the same organization", () => {
    // A lookup by id alone would let one tenant resolve another tenant's names.
    const lookup = helper.slice(helper.indexOf("export async function lookupNames"));
    expect(lookup).toMatch(/\.eq\("organization_id", context\.activeOrganization\.id\)/);
    expect(lookup).toMatch(/\.in\("id", unique\)/);
  });
});

describe.each(listRoutes)("$name list route", ({ path, table }) => {
  const route = read(path);

  it("delegates to the shared tenant boundary", () => {
    expect(route).toMatch(/tenantListResponse</);
    expect(route).toContain(`table: "${table}"`);
  });

  it("selects an explicit column list rather than a wildcard", () => {
    expect(route).toMatch(/columns: "/);
    expect(route).not.toMatch(/columns: "\*"/);
  });
});

describe("list routes withhold sensitive columns", () => {
  it("omits agent run input and output payloads", () => {
    const route = read("app/api/runs/route.ts");
    const columns = /columns: "([^"]+)"/.exec(route)?.[1] ?? "";
    expect(columns).not.toMatch(/\binput\b/);
    expect(columns).not.toMatch(/\boutput\b/);
  });

  it("omits report bodies from the list view", () => {
    const columns = /columns: "([^"]+)"/.exec(read("app/api/reports/route.ts"))?.[1] ?? "";
    expect(columns).not.toMatch(/\bcontent\b/);
  });

  it("omits caller-supplied command parameters", () => {
    const route = read("app/api/commands/route.ts");
    const columns = /table: "commands",\s*\n\s*columns: "([^"]+)"/.exec(route)?.[1] ?? "";
    expect(columns).not.toBe("");
    expect(columns).not.toMatch(/\bparameters\b/);
  });
});

describe("no surface ships seeded data", () => {
  it("has no demo-data module left in the tree", () => {
    expect(() => read("lib/demo-data.ts")).toThrow();
  });
});
