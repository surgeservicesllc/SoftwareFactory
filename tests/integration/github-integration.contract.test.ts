// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(path: string) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

const migration = source("supabase/migrations/20260812000400_github_integration.sql");
const ambiguityRepairMigration = source(
  "supabase/migrations/20260812000800_fix_github_sync_ambiguity.sql",
);
const syncAndProjectHardeningMigration = source(
  "supabase/migrations/20260812000900_harden_github_project_and_sync.sql",
);

describe("Phase 1B GitHub App schema contract", () => {
  const tables = [
    "github_installations",
    "github_repositories",
    "github_webhook_deliveries",
    "github_change_requests",
  ];

  it("adds tenant-owned metadata tables with RLS and FORCE RLS", () => {
    for (const table of tables) {
      expect(migration).toMatch(new RegExp(`create table public\\.${table} \\(`));
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
      expect(migration).toContain(`alter table public.${table} force row level security;`);
    }
    expect(migration).toContain("public.is_organization_member(organization_id)");
    expect(migration).toContain("public.can_manage_project(project_id)");
    expect(migration).toContain("public.can_manage_organization(organization_id)");
  });

  it("allows organization members, denies unrelated/anonymous reads, and reserves provider mutations for the server", () => {
    expect(migration).toMatch(
      /create policy github_installations_select_members[\s\S]*public\.is_organization_member\(organization_id\)/i,
    );
    expect(migration).toMatch(
      /revoke all on table public\.github_installations from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /grant select on table public\.github_installations to authenticated/i,
    );
    expect(migration).toMatch(
      /grant select, insert, update on table public\.github_installations to service_role/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.sync_github_installation[\s\S]*to service_role/i,
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.sync_github_installation[\s\S]{0,300}to authenticated/i,
    );
  });

  it("stores only GitHub identifiers and an opaque environment secret reference", () => {
    expect(migration).toContain("'env://GITHUB_APP'");
    expect(migration).toContain("github_installations_permissions_no_sensitive_data");
    expect(migration).toContain("github_webhook_deliveries_payload_no_sensitive_data");
    expect(migration).not.toMatch(/\b(access_token|refresh_token|private_key|webhook_secret)\s+(text|jsonb|bytea)/i);
  });

  it("makes webhook delivery and change submission idempotent", () => {
    expect(migration).toContain("github_webhook_deliveries_external_unique unique (external_delivery_id)");
    expect(migration).toContain("github_change_requests_idempotency_unique unique (organization_id, idempotency_key)");
    expect(migration).toContain("status text not null default 'reserved'");
  });

  it("records installation sync and draft PR evidence through immutable audit foundations", () => {
    expect(migration).toContain("insert into public.activity_events (");
    expect(migration).toContain("'GitHub App installation synchronized'");
    expect(migration).toContain("insert into public.pull_requests");
    expect(migration).toContain("'draft'::public.pull_request_status");
  });

  it("repairs installation sync ambiguity through an additive least-privilege migration", () => {
    expect(ambiguityRepairMigration).toContain(
      "create or replace function public.sync_github_installation(",
    );
    expect(ambiguityRepairMigration).toContain(
      "where synced_repository.installation_id = resolved_installation_id;",
    );
    expect(ambiguityRepairMigration).toContain(
      "on conflict on constraint github_repositories_external_unique do update set",
    );
    expect(ambiguityRepairMigration).not.toMatch(
      /where\s+installation_id\s*=\s*resolved_installation_id/i,
    );
    expect(ambiguityRepairMigration).not.toMatch(
      /on\s+conflict\s*\(\s*installation_id\s*,\s*external_repository_id\s*\)/i,
    );
    expect(ambiguityRepairMigration).toMatch(
      /revoke all on function public\.sync_github_installation[\s\S]*from public, anon, authenticated/i,
    );
    expect(ambiguityRepairMigration).toMatch(
      /grant execute on function public\.sync_github_installation[\s\S]*to service_role/i,
    );
    expect(ambiguityRepairMigration).not.toMatch(
      /\b(drop\s+(?:function|table)|truncate|disable\s+row\s+level\s+security)\b/i,
    );
  });

  it("serializes first installation sync and re-resolves its authoritative binding", () => {
    const lockPosition = syncAndProjectHardeningMigration.indexOf(
      "pg_catalog.pg_advisory_xact_lock(",
    );
    const connectionInsertPosition = syncAndProjectHardeningMigration.indexOf(
      "insert into public.connections (",
    );
    const installationUpsertPosition = syncAndProjectHardeningMigration.indexOf(
      "insert into public.github_installations (",
    );
    const authoritativeReadPosition = syncAndProjectHardeningMigration.indexOf(
      "where installation.id = resolved_installation_id",
    );

    expect(lockPosition).toBeGreaterThan(0);
    expect(lockPosition).toBeLessThan(connectionInsertPosition);
    expect(connectionInsertPosition).toBeLessThan(installationUpsertPosition);
    expect(authoritativeReadPosition).toBeGreaterThan(installationUpsertPosition);
    expect(syncAndProjectHardeningMigration).toContain(
      "'softwarefactory:github-installation:' || p_external_installation_id::text",
    );
    expect(syncAndProjectHardeningMigration).toMatch(
      /select installation\.organization_id, installation\.connection_id[\s\S]*into existing_organization_id, resolved_connection_id[\s\S]*where installation\.id = resolved_installation_id/i,
    );
  });

  it("uses the synchronized GitHub default branch as the only project branch authority", () => {
    expect(syncAndProjectHardeningMigration).toContain(
      "expected_branch is distinct from repository_record.default_branch",
    );
    expect(syncAndProjectHardeningMigration).toContain(
      "resolved_branch := repository_record.default_branch;",
    );
    expect(syncAndProjectHardeningMigration).not.toContain(
      "resolved_branch := btrim(coalesce(nullif(p_default_branch, ''), repository_record.default_branch));",
    );
  });
});

describe("GitHub App server/API contract", () => {
  it("keeps provider credentials behind server-only modules", () => {
    const config = source("lib/github/config.ts");
    const client = source("lib/github/client.ts");
    expect(config).toMatch(/^import "server-only";/);
    expect(client).toMatch(/^import "server-only";/);
    expect(config).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(config).toContain("GITHUB_APP_WEBHOOK_SECRET");
    expect(config).not.toContain("NEXT_PUBLIC_GITHUB");
  });

  it("verifies the raw webhook HMAC before parsing and deduplicates delivery ids", () => {
    const webhook = source("app/api/github/webhooks/route.ts");
    const signaturePosition = webhook.indexOf("verifyGitHubWebhookSignature");
    const parsePosition = webhook.indexOf("JSON.parse");
    expect(signaturePosition).toBeGreaterThan(0);
    expect(parsePosition).toBeGreaterThan(signaturePosition);
    expect(webhook).toContain('request.headers.get("x-github-delivery")');
    expect(webhook).toContain('insertResult.error?.code === "23505"');
    expect(webhook).toContain('"repository"');
    expect(webhook).toContain('"status"');
    expect(webhook).toContain('"workflow_run"');
    expect(webhook).not.toMatch(/console\.(log|error|warn)/);
  });

  it("scopes installation tokens to one selected repository and explicit permissions", () => {
    const route = source("lib/github/route.ts");
    const client = source("lib/github/client.ts");
    expect(route).toContain("repositoryIds: [context.repository.externalId]");
    expect(route).toContain("permissions,");
    expect(client).toContain("body.repository_ids = scope.repositoryIds");
    expect(client).toContain("body.permissions = scope.permissions");
  });

  it("matches repository coordinates literally instead of using SQL wildcard semantics", () => {
    const access = source("lib/github/access.ts");
    expect(access).not.toContain('.ilike("full_name"');
    expect(access).toContain("candidate.full_name.toLowerCase() === normalizedFullName");
  });

  it("offers safe file changes but no merge or default-branch mutation endpoint", () => {
    const changes = source("app/api/github/repositories/[owner]/[repo]/changes/route.ts");
    expect(changes).toContain("isProtectedGitHubWritePath");
    expect(changes).toContain("expectedBlobSha");
    expect(changes).toContain("softwarefactory/");
    expect(changes).toContain("createGitHubDraftPullRequest");
    expect(changes).toContain("draft: true");
    expect(changes).not.toMatch(/mergeGitHub|\/merges|\/merge\b/);
  });

  it("provides all required live read API surfaces", () => {
    const paths = [
      "app/api/github/connections/route.ts",
      "app/api/github/repositories/route.ts",
      "app/api/github/repositories/[owner]/[repo]/branches/route.ts",
      "app/api/github/repositories/[owner]/[repo]/commits/route.ts",
      "app/api/github/repositories/[owner]/[repo]/pulls/route.ts",
      "app/api/github/repositories/[owner]/[repo]/checks/route.ts",
      "app/api/github/repositories/[owner]/[repo]/tree/route.ts",
      "app/api/github/repositories/[owner]/[repo]/contents/route.ts",
    ];
    for (const path of paths) {
      expect(source(path)).toContain("export async function GET");
      expect(source(path)).toContain("githubRouteErrorResponse");
    }
  });
});
