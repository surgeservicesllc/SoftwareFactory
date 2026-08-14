// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const routes = [
  "app/api/agentos/grants/route.ts",
  "app/api/agentos/inbox/route.ts",
  "app/api/agentos/goals/route.ts",
  "app/api/agentos/chains/route.ts",
  "app/api/agentos/triggers/route.ts",
];

function source(path: string) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

/**
 * The AgentOS read boundary.
 *
 * These routes expose permission and credential-adjacent state, so what may
 * cross to a browser is asserted rather than left to review.
 */
describe("AgentOS API routes", () => {
  it("reads through the safe projection, never a base table", () => {
    for (const route of routes) {
      const body = source(route);
      expect(body, `${route} must use the shared tenant boundary`)
        .toContain("tenantRpcListResponse");
      // A direct .from() here would bypass the projection that decides which
      // columns leave the database.
      expect(body, `${route} reads a table directly`).not.toMatch(/\.from\(/);
    }
  });

  it("is read-only", () => {
    for (const route of routes) {
      const body = source(route);
      for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
        expect(body, `${route} gained a ${method}`).not.toContain(`export async function ${method}`);
      }
    }
  });

  it("never carries a credential name or a callable trigger URL to the browser", () => {
    const projection = source("supabase/migrations/20260814000900_agentos_safe_list_reads.sql");

    // Presence, not value, and not even which variable holds it: knowing that
    // is itself a hint worth withholding.
    expect(projection).toContain("(t.secret_env_var is not null)");
    expect(source("app/api/agentos/triggers/route.ts")).not.toContain("secret_env_var");
    expect(source("app/api/agentos/triggers/route.ts")).not.toContain("public_slug");

    for (const route of routes) {
      expect(source(route), route).not.toMatch(/credential_env_var|secret_env_var|public_slug/);
    }
  });

  it("resolves membership inside every projection", () => {
    const projection = source("supabase/migrations/20260814000900_agentos_safe_list_reads.sql");
    const functions = projection.match(/create or replace function public\.agentos_list_\w+/g) ?? [];

    expect(functions.length).toBe(5);
    // One membership check per function, so a caller cannot read another
    // organization's rows by passing its id.
    expect((projection.match(/organization membership is required/g) ?? []).length)
      .toBe(functions.length);
    // And none of them is reachable by the machine role.
    expect((projection.match(/from public, anon, service_role/g) ?? []).length)
      .toBe(functions.length);
  });

  it("bounds every projection's row count", () => {
    const projection = source("supabase/migrations/20260814000900_agentos_safe_list_reads.sql");
    expect((projection.match(/least\(coalesce\(p_limit, 50\), 100\)/g) ?? []).length).toBe(5);
  });
});
