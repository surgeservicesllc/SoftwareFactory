// @vitest-environment node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(path: string) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

function walk(directory: string, matches: (path: string) => boolean): string[] {
  const absolute = resolve(repositoryRoot, directory);
  const found: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const relative = `${directory}/${entry}`;
    if (statSync(resolve(repositoryRoot, relative)).isDirectory()) {
      found.push(...walk(relative, matches));
    } else if (matches(relative)) {
      found.push(relative);
    }
  }
  return found;
}

const MUTATING_METHOD = /export async function (POST|PATCH|PUT|DELETE)\b/;

describe("Phase 1C execution boundaries", () => {
  it("keeps the service-role credential out of every interactive handler", () => {
    const routes = walk("app", (path) => path.endsWith("route.ts"));
    const allowed = new Set([
      // The signed webhook and the durable worker tick are the only machine
      // boundaries permitted to hold the service-role credential.
      "app/api/github/webhooks/route.ts",
      "app/api/worker/tick/route.ts",
      // Phase 1B boundaries that call an audited SECURITY DEFINER routine which
      // re-validates the actor, organization, and resource for itself.
      "app/api/github/repositories/[owner]/[repo]/changes/route.ts",
      "app/api/github/connections/[connectionId]/disconnect/route.ts",
      "app/api/github/connections/[connectionId]/sync/route.ts",
    ]);

    for (const route of routes) {
      if (allowed.has(route)) continue;
      const body = source(route);
      expect(body, route).not.toMatch(/createSupabaseServiceRoleClient|createSupabaseGitHubWebhookClient/);
      expect(body, route).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });

  it("never exposes a provider credential to the browser", () => {
    const clientFiles = [
      ...walk("components", (path) => path.endsWith(".tsx")),
      ...walk("lib/client", (path) => path.endsWith(".ts")),
    ];

    for (const file of clientFiles) {
      const body = source(file);
      expect(body, file).not.toMatch(/OPENAI_API_KEY|WORKER_TICK_SECRET|CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
      expect(body, file).not.toMatch(/GITHUB_APP_(PRIVATE_KEY|CLIENT_SECRET|WEBHOOK_SECRET|STATE_SECRET)/);
    }
  });

  it("requires a same-origin check on every cookie-authenticated mutation", () => {
    const routes = walk("app/api", (path) => path.endsWith("route.ts"));
    const machineBoundaries = new Set([
      // Authenticated by a signature or a bearer secret, not by a cookie.
      "app/api/github/webhooks/route.ts",
      "app/api/worker/tick/route.ts",
    ]);

    for (const route of routes) {
      const body = source(route);
      if (!MUTATING_METHOD.test(body) || machineBoundaries.has(route)) continue;
      expect(body, route).toContain("assertSameOriginRequest");
    }
  });

  it("declares the Node runtime on every API route", () => {
    for (const route of walk("app/api", (path) => path.endsWith("route.ts"))) {
      expect(source(route), route).toContain('export const runtime = "nodejs"');
    }
  });

  it("scopes every tenant read to the exact active organization", () => {
    const tenantRoutes = [
      "app/api/dashboard/route.ts",
      "app/api/runs/route.ts",
      "app/api/tasks/route.ts",
      "app/api/agents/route.ts",
      "app/api/reports/route.ts",
      "app/api/connections/route.ts",
      "app/api/activity/route.ts",
      "app/api/commands/route.ts",
    ];

    for (const route of tenantRoutes) {
      const body = source(route);
      expect(body, route).toContain("withTenant");
      expect(body, route).toContain('.eq("organization_id", activeOrganization.id)');
    }
    expect(source("lib/server/tenant-route.ts")).toContain("requireActiveOrganization()");
  });

  it("gates run cancellation and backlog writes behind organization management", () => {
    expect(source("app/api/runs/[runId]/cancel/route.ts")).toContain("isOrganizationManager(activeOrganization)");
    expect(source("app/api/tasks/route.ts")).toContain("isOrganizationManager(activeOrganization)");
    expect(source("app/api/agents/route.ts")).toContain("isOrganizationManager(activeOrganization)");
    expect(source("app/api/settings/route.ts")).toContain('activeOrganization.role !== "owner"');
  });

  it("keeps the durable worker boundary revoked from browser sessions in SQL", () => {
    const workflows = source("supabase/migrations/20260812001600_phase1c_execution_workflows.sql");

    for (const routine of [
      "claim_agent_runs",
      "heartbeat_agent_run",
      "finish_agent_run",
      "record_run_event",
      "record_run_workspace",
      "record_run_result",
      "record_run_pull_request",
    ]) {
      expect(workflows, routine).toMatch(
        new RegExp(`revoke all on function public\\.${routine}[\\s\\S]*?from public, anon, authenticated`),
      );
      expect(workflows, routine).not.toMatch(
        new RegExp(`grant execute on function public\\.${routine}[^;]*to (authenticated|anon)`),
      );
    }
  });

  it("introduces no merge, deploy, or rollback executor", () => {
    const serverFiles = [
      ...walk("app/api", (path) => path.endsWith("route.ts")),
      ...walk("lib", (path) => path.endsWith(".ts")),
    ];

    for (const file of serverFiles) {
      const body = source(file);
      expect(body, file).not.toMatch(/\/merge\b|\bmergePullRequest\b|createDeployment\b|\/rollback\b/);
    }
  });

  it("only ever opens draft pull requests", () => {
    const runner = source("lib/worker/runner.ts");

    expect(runner).toContain("createGitHubDraftPullRequest");
    expect(runner).not.toMatch(/draft:\s*false/);
    expect(source("lib/github/repository.ts")).toContain("draft: true");
  });

  it("keeps the Phase 1D interlocks untouched by Phase 1C migrations", () => {
    for (const migration of [
      "supabase/migrations/20260812001400_phase1c_execution_enums.sql",
      "supabase/migrations/20260812001500_phase1c_execution_schema.sql",
      "supabase/migrations/20260812001600_phase1c_execution_workflows.sql",
    ]) {
      const body = source(migration);
      expect(body, migration).not.toMatch(/drop\s+constraint\s+organizations_phase1d_kill_switch_active/i);
      expect(body, migration).not.toMatch(/drop\s+constraint\s+projects_phase1d_green_observation_only/i);
      expect(body, migration).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
      expect(body, migration).not.toMatch(/disable\s+row\s+level\s+security|drop\s+table/i);
    }
  });

  it("defaults commanded execution to OFF and separates it from the autonomy switch", () => {
    const schema = source("supabase/migrations/20260812001500_phase1c_execution_schema.sql");

    expect(schema).toMatch(/execution_enabled boolean not null default false/);
    expect(schema).toContain("never enables autonomous approval, merge, deployment, or rollback");
  });

  it("gives every new table row level security with read-only authenticated grants", () => {
    const schema = source("supabase/migrations/20260812001500_phase1c_execution_schema.sql");

    for (const table of ["run_events", "run_workspaces", "run_results", "organization_settings"]) {
      expect(schema, table).toContain(`alter table public.${table} enable row level security`);
      expect(schema, table).toContain(`alter table public.${table} force row level security`);
      expect(schema, table).toContain(`revoke all on table public.${table} from anon, authenticated`);
      expect(schema, table).toContain(`grant select on table public.${table} to authenticated`);
      expect(schema, table).not.toContain(`grant insert on table public.${table} to authenticated`);
    }
  });

  it("keeps run evidence free of provider reasoning and file bodies", () => {
    const runner = source("lib/worker/runner.ts");
    const detailRoute = source("app/api/runs/[runId]/route.ts");

    // Event metadata carries paths, counts, and status labels — never the file
    // content or provider reasoning that produced them.
    expect(runner).not.toMatch(/p_metadata:[\s\S]{0,200}\bcontent\b/);
    expect(runner).not.toMatch(/this\.event\([\s\S]{0,200}change\.content/);

    // The browser never receives a content-bearing column from run evidence.
    const selects = [...detailRoute.matchAll(/\.select\(\s*([\s\S]*?)\)/g)]
      .map(([, columns]) => columns)
      .join(" ");
    expect(selects).not.toMatch(/\bcontent\b|\breasoning\b|\bprompt_tokens\b/);
    expect(selects).toContain("message");
  });
});
