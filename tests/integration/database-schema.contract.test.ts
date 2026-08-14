// @vitest-environment node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const requiredTables = [
  "profiles",
  "projects",
  "connections",
  "project_connections",
  "agents",
  "commands",
  "tasks",
  "agent_runs",
  "pull_requests",
  "deployments",
  "test_runs",
  "incidents",
  "reports",
  "activity_events",
  "policies",
  "approvals",
  "github_installations",
  "github_repositories",
  "github_webhook_deliveries",
  "github_change_requests",
  "github_protected_change_approvals",
  "bots",
  "bot_roles",
  "bot_assignments",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tableReferencePattern(table: string): string {
  return `(?:public\\s*\\.\\s*)?"?${escapeRegExp(table)}"?`;
}

function readMigrations(): { files: string[]; sql: string } {
  expect(existsSync(migrationsDirectory), "supabase/migrations must exist").toBe(
    true,
  );

  const files = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  return {
    files,
    sql: files
      .map((file) => readFileSync(resolve(migrationsDirectory, file), "utf8"))
      .join("\n"),
  };
}

function getCreateTableBody(sql: string, table: string): string {
  const tableStart = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${tableReferencePattern(table)}\\s*\\(`,
    "i",
  ).exec(sql);

  expect(tableStart, `missing CREATE TABLE for ${table}`).not.toBeNull();

  const openingParenthesis = (tableStart?.index ?? 0) +
    (tableStart?.[0].lastIndexOf("(") ?? 0);
  let depth = 0;

  for (let index = openingParenthesis; index < sql.length; index += 1) {
    if (sql[index] === "(") depth += 1;
    if (sql[index] === ")") depth -= 1;

    if (depth === 0) {
      return sql.slice(openingParenthesis + 1, index);
    }
  }

  throw new Error(`unterminated CREATE TABLE statement for ${table}`);
}

describe("Supabase migration contract", () => {
  const migrations = readMigrations();

  it("uses ordered SQL migrations", () => {
    expect(migrations.files.length).toBeGreaterThanOrEqual(2);

    for (const file of migrations.files) {
      expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
  });

  it.each(requiredTables)("defines %s with a UUID primary key and timestamps", (table) => {
    const body = getCreateTableBody(migrations.sql, table);

    expect(body, `${table} must define an id UUID`).toMatch(/\bid\s+uuid\b/i);
    expect(body, `${table} must define a primary key`).toMatch(
      /primary\s+key/i,
    );
    expect(body, `${table} must record creation time`).toMatch(
      /\bcreated_at\s+timestamptz\b/i,
    );
  });

  it("provides organization ownership and relational integrity", () => {
    expect(migrations.sql).toMatch(/create\s+table[\s\S]+organizations/i);
    expect(migrations.sql).toMatch(/organization_members/i);
    expect(migrations.sql).toMatch(/\breferences\s+public\s*\./i);

    for (const table of requiredTables.filter((name) => name !== "profiles")) {
      expect(
        getCreateTableBody(migrations.sql, table),
        `${table} must be organization-owned`,
      ).toMatch(/\borganization_id\s+uuid\b/i);
    }
  });

  it("defines status enums and indexes for control-plane queries", () => {
    expect(migrations.sql).toMatch(/create\s+type[\s\S]+as\s+enum/i);
    expect(migrations.sql.match(/create\s+(?:unique\s+)?index/gi)?.length ?? 0).toBeGreaterThanOrEqual(
      requiredTables.length,
    );
  });

  it.each(requiredTables)("enables and forces RLS on %s", (table) => {
    const reference = tableReferencePattern(table);

    expect(migrations.sql).toMatch(
      new RegExp(
        `alter\\s+table\\s+(?:if\\s+exists\\s+)?${reference}\\s+enable\\s+row\\s+level\\s+security`,
        "i",
      ),
    );
    expect(migrations.sql).toMatch(
      new RegExp(
        `alter\\s+table\\s+(?:if\\s+exists\\s+)?${reference}\\s+force\\s+row\\s+level\\s+security`,
        "i",
      ),
    );
    expect(migrations.sql).toMatch(
      new RegExp(`create\\s+policy\\s+[^;]+?on\\s+${reference}\\b`, "i"),
    );
  });

  it("never disables row level security", () => {
    expect(migrations.sql).not.toMatch(/disable\s+row\s+level\s+security/i);
  });

  it("stores connection metadata without plaintext credential columns", () => {
    const connectionBody = getCreateTableBody(migrations.sql, "connections");

    expect(connectionBody).not.toMatch(
      /^\s*"?(?:password|api_key|secret|token)"?\s+/im,
    );
  });

  it("implements database-level RED approval and activity audit foundations", () => {
    expect(migrations.sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.has_valid_owner_approval/i,
    );
    expect(migrations.sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.enforce_red_task_execution/i,
    );
    expect(migrations.sql).toMatch(
      /RED task execution requires an unexpired approval decided by an organization owner/i,
    );
    expect(migrations.sql).toMatch(
      /create\s+trigger\s+tasks_red_execution_gate[\s\S]+?execute\s+function\s+public\.enforce_red_task_execution\(\)/i,
    );
    expect(migrations.sql).toMatch(/insert\s+into\s+public\.activity_events/i);
    expect(migrations.sql).toMatch(
      /create\s+trigger\s+activity_events_append_only[\s\S]+?before\s+update\s+or\s+delete\s+on\s+public\.activity_events/i,
    );
  });
});
