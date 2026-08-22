// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

const listRoutes = [
  { name: "agents", path: "app/api/agents/route.ts", rpc: "list_agents" },
  { name: "tasks", path: "app/api/tasks/route.ts", rpc: "list_tasks" },
  { name: "runs", path: "app/api/runs/route.ts", rpc: "list_agent_runs" },
  { name: "reports", path: "app/api/reports/route.ts", rpc: "list_reports" },
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

  it("bounds the row count and never caches a tenant response", () => {
    expect(helper).toMatch(/\.max\(100\)/);
    expect(helper).toContain("p_limit: parsed.data.limit");
    expect(helper).toMatch(/jsonNoStore/);
  });

  it("passes the exact active organization into the safe RPC", () => {
    expect(helper).toMatch(/p_organization_id: context\.activeOrganization\.id/);
  });
});

describe.each(listRoutes)("$name list route", ({ path, rpc }) => {
  const route = read(path);

  it("delegates to the shared tenant boundary", () => {
    expect(route).toMatch(/tenantRpcListResponse</);
    expect(route).toContain(`rpc: "${rpc}"`);
  });
});

describe("commands list route", () => {
  const route = read("app/api/commands/route.ts");
  const queryContract = route.split("const commandListQuerySchema")[1]
    ?.split("function commandExecutionMode")[0] ?? "";
  const getHandler = route.split("export async function GET")[1] ?? "";

  it("validates projectId and binds it to the canonical tenant RPC", () => {
    expect(queryContract).toMatch(/projectId: z\.string\(\)\.uuid\(\)\.optional\(\)/);
    expect(getHandler).toMatch(
      /projectId: url\.searchParams\.get\("projectId"\) \?\? undefined/,
    );
    expect(getHandler).toMatch(
      /context\.client\.rpc\("list_factory_commands", \{[\s\S]*?p_project_id: parsed\.data\.projectId \?\? null/,
    );
  });

  it("uses only the PGRST202 legacy fallback and defensively filters project history", () => {
    expect(getHandler).toMatch(
      /if \(result\.error\?\.code === "PGRST202"\) \{\s*result = await context\.client\.rpc\("list_commands"/,
    );
    expect(getHandler).toMatch(
      /parsed\.data\.projectId === undefined \|\| row\.project_id === parsed\.data\.projectId/,
    );
  });

  it("projects only the canonical command execution disposition", () => {
    expect(route).toMatch(
      /value === "manual" \|\| value === "record_only" \? value : "unknown"/,
    );
    expect(getHandler).toContain("executionMode: commandExecutionMode(row.execution_mode)");
  });
});

describe("list routes withhold sensitive columns", () => {
  it("omits agent run payloads and raw provider errors", () => {
    // Scoped to the GET handler, matching how the commands route is asserted
    // below. The POST handler records a provider run and therefore must handle
    // its input, output, and error text; the guarantee being protected here is
    // that the *list view* never projects those columns to the browser.
    const listHandler = read("app/api/runs/route.ts")
      .split("export async function GET")[1]
      ?.split("export async function POST")[0] ?? "";
    expect(listHandler).not.toBe("");
    expect(listHandler).not.toMatch(/\b(input|output|error_message)\b/);
  });

  it("omits report bodies from the list view", () => {
    expect(read("app/api/reports/route.ts")).not.toMatch(/\bcontent\b/);
  });

  it("omits caller-supplied command parameters", () => {
    const getHandler = read("app/api/commands/route.ts").split("export async function GET")[1] ?? "";
    expect(getHandler).not.toMatch(/\bparameters\b/);
  });

});

describe("provider routes preserve hardened tenant reads", () => {
  const service = read("lib/providers/service.ts");
  const preview = read("app/api/runs/preview/route.ts");
  const runs = read("app/api/runs/route.ts");

  it("never restores direct agents or agent_runs reads", () => {
    for (const source of [service, preview, runs]) {
      expect(source).not.toMatch(/\.from\(["'](?:agents|agent_runs)["']\)/);
    }
    expect(service).toContain('rpc("list_provider_run_metrics"');
    expect(preview).toContain('rpc("get_provider_agent_assignment"');
    expect(runs).toContain('rpc("get_provider_agent_assignment"');
  });

  it("keeps preview no-contact and opts into provider probes only after run validation", () => {
    expect(preview).not.toContain("probeProviders: true");
    expect(runs).toContain("{ probeProviders: true }");
    expect(service).toMatch(/executionEnabled\s*&&\s*options\.probeProviders\s*===\s*true/);

    const taskCheck = runs.indexOf("const task = await loadTask");
    const agentCheck = runs.indexOf("const agent = await loadAgent");
    const contextLoad = runs.indexOf("const context = await loadProjectRoutingContext");
    expect(taskCheck).toBeGreaterThan(-1);
    expect(agentCheck).toBeGreaterThan(taskCheck);
    expect(contextLoad).toBeGreaterThan(agentCheck);
  });
});

describe("safe list migration", () => {
  const migration = read("supabase/migrations/20260812002000_safe_tenant_list_reads.sql");

  it("revokes direct authenticated reads from payload-bearing tables", () => {
    for (const table of ["agents", "commands", "tasks", "agent_runs", "reports"]) {
      expect(migration).toContain(`revoke select on table public.${table} from authenticated`);
    }
  });

  it("derives tenant access from auth.uid and binds the requested organization", () => {
    expect(migration).toMatch(/public\.is_organization_member\(p_organization_id\)/g);
    expect(migration).toMatch(/organization_id = p_organization_id/g);
  });
});

describe("no surface ships seeded data", () => {
  it("has no demo-data module left in the tree", () => {
    expect(() => read("lib/demo-data.ts")).toThrow();
  });
});
