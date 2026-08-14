// @vitest-environment node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const fabricTables = ["bots", "bot_roles", "bot_assignments"] as const;

const mutationFunctions = [
  "register_bot",
  "update_bot",
  "record_bot_readiness",
  "retire_bot",
  "save_bot_role",
  "remove_bot_role",
  "assign_bot",
  "update_bot_assignment",
] as const;

function readMigrations(): string {
  expect(existsSync(migrationsDirectory), "supabase/migrations must exist").toBe(true);

  return readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(resolve(migrationsDirectory, file), "utf8"))
    .join("\n");
}

function readMigration(fileNamePart: string): string {
  const match = readdirSync(migrationsDirectory).find(
    (file) => file.endsWith(".sql") && file.includes(fileNamePart),
  );
  expect(match, `a migration matching ${fileNamePart} must exist`).toBeDefined();
  return readFileSync(resolve(migrationsDirectory, match as string), "utf8");
}

function functionBody(sql: string, name: string): string {
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$function\\$[\\s\\S]*?\\$function\\$;`,
    "i",
  );
  const match = pattern.exec(sql);
  expect(match, `public.${name} must be defined`).not.toBeNull();
  return match?.[0] ?? "";
}

describe("bot fabric migration contract", () => {
  const sql = readMigrations();

  it("adds the audit vocabulary in its own migration ahead of the tables", () => {
    const enumMigration = readMigration("bot_fabric_activity_types");
    const tableMigration = readMigration("bot_fabric.sql");

    for (const label of [
      "bot.registered",
      "bot.updated",
      "bot.retired",
      "bot.readiness_checked",
      "bot_role.saved",
      "bot_role.removed",
      "bot.assigned",
      "bot.moved",
      "bot.assignment_changed",
    ]) {
      expect(enumMigration).toContain(`add value if not exists '${label}'`);
    }
    // PostgreSQL rejects using a label in the transaction that created it.
    expect(tableMigration).not.toMatch(/alter\s+type\s+public\.activity_event_type/i);
  });

  it.each(fabricTables)("enables and forces row level security on %s", (table) => {
    expect(sql).toMatch(
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
    );
    expect(sql).toMatch(
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+force\\s+row\\s+level\\s+security`, "i"),
    );
    expect(sql).toMatch(
      new RegExp(`create\\s+policy\\s+${table}_select_members\\s+on\\s+public\\.${table}`, "i"),
    );
  });

  it.each(fabricTables)("grants authenticated callers read access only on %s", (table) => {
    expect(sql).toMatch(
      new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+anon,\\s*authenticated`, "i"),
    );
    expect(sql).toMatch(
      new RegExp(`grant\\s+select\\s+on\\s+table\\s+public\\.${table}\\s+to\\s+authenticated`, "i"),
    );
    expect(sql).not.toMatch(
      new RegExp(`grant[^;]*\\b(?:insert|update|delete)\\b[^;]*on\\s+table\\s+public\\.${table}\\s+to\\s+authenticated`, "i"),
    );
  });

  it("has no direct-write policy on any fabric table", () => {
    for (const table of fabricTables) {
      expect(sql).not.toMatch(
        new RegExp(`create\\s+policy\\s+\\w+\\s+on\\s+public\\.${table}\\s+for\\s+(?:insert|update|delete)`, "i"),
      );
    }
  });

  it.each(mutationFunctions)("routes %s through an audited definer boundary", (name) => {
    const body = functionBody(sql, name);

    expect(body).toMatch(/security\s+definer/i);
    expect(body).toMatch(/set\s+search_path\s*=\s*pg_catalog/i);
    expect(body).toMatch(/public\.assert_bot_fabric_manager\(/);
    expect(body).toMatch(/insert\s+into\s+public\.activity_events/i);
  });

  it("requires an authenticated manager inside the trusted boundary", () => {
    const body = functionBody(sql, "assert_bot_fabric_manager");

    expect(body).toMatch(/auth\.uid\(\)/);
    expect(body).toMatch(/authentication is required/);
    expect(body).toMatch(/public\.can_manage_organization\(/);
  });

  it("revokes the fabric functions from anonymous callers and grants only the mutations", () => {
    for (const name of mutationFunctions) {
      expect(sql).toMatch(
        new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\([^)]*\\)\\s+from\\s+public,\\s*anon,\\s*authenticated`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^)]*\\)\\s+to\\s+authenticated`, "i"),
      );
    }

    for (const helper of ["assert_bot_fabric_manager", "normalize_bot_credential_ref"]) {
      expect(sql).toMatch(
        new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${helper}\\([^)]*\\)\\s+from\\s+public,\\s*anon,\\s*authenticated`, "i"),
      );
      expect(sql).not.toMatch(
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${helper}\\([^)]*\\)\\s+to\\s+authenticated`, "i"),
      );
    }
  });

  it("stores a credential reference and never credential material", () => {
    const tableMigration = readMigration("bot_fabric.sql");

    expect(tableMigration).toMatch(/credential_ref\s+text/i);
    expect(tableMigration).not.toMatch(/^\s*(?:api_key|secret|token|password)\s+text/im);
    expect(tableMigration).toMatch(/bots_credential_ref_shape/);
    expect(tableMigration).toMatch(/bots_credential_ref_not_privileged/);

    for (const privileged of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
      "DATABASE_URL",
      "VERCEL_TOKEN",
    ]) {
      expect(tableMigration).toContain(`'${privileged}'`);
    }
    expect(tableMigration).toMatch(/not\s+like\s+'NEXT\\_PUBLIC\\_%'/i);
  });

  it("requires HTTPS for any bot endpoint", () => {
    const tableMigration = readMigration("bot_fabric.sql");

    expect(tableMigration).toMatch(/bots_base_url_https/);
    expect(tableMigration).toMatch(/\^https:\/\//);
  });

  it("keeps a bot to one open posting so a move is a single transition", () => {
    expect(sql).toMatch(
      /create\s+unique\s+index\s+bot_assignments_one_open_posting_per_bot\s+on\s+public\.bot_assignments\s*\(bot_id\)\s*where\s+status\s*<>\s*'released'/i,
    );
  });

  it("binds assignments to the project and role of the same tenant", () => {
    const tableMigration = readMigration("bot_fabric.sql");

    expect(tableMigration).toMatch(
      /foreign\s+key\s*\(bot_id,\s*organization_id\)\s*references\s+public\.bots\(id,\s*organization_id\)/i,
    );
    expect(tableMigration).toMatch(
      /foreign\s+key\s*\(project_id,\s*organization_id\)\s*references\s+public\.projects\(id,\s*organization_id\)/i,
    );
    expect(tableMigration).toMatch(
      /foreign\s+key\s*\(role_id,\s*organization_id\)\s*references\s+public\.bot_roles\(id,\s*organization_id\)/i,
    );
  });

  it("attaches the sensitive-data and timestamp guards to every fabric table", () => {
    const tableMigration = readMigration("bot_fabric.sql");

    expect(tableMigration).toMatch(/public\.reject_sensitive_row_data\(\)/);
    expect(tableMigration).toMatch(/public\.set_updated_at\(\)/);
    expect(tableMigration).toMatch(/public\.prevent_organization_reassignment\(\)/);
    expect(tableMigration).toMatch(/foreach\s+target_table\s+in\s+array\s+array\[[^\]]*'bots'[^\]]*'bot_roles'[^\]]*'bot_assignments'/i);
  });

  it("records assignment audit metadata that denies execution", () => {
    const body = functionBody(sql, "assign_bot");

    expect(body).toMatch(/'executor_connected',\s*false/);
    expect(body).toMatch(/not execution/i);
  });

  it("refuses to remove a role that bots still hold", () => {
    const body = functionBody(sql, "remove_bot_role");

    expect(body).toMatch(/release the bots holding this role/i);
  });

  it("resets readiness when a bot's configuration changes", () => {
    const body = functionBody(sql, "update_bot");

    expect(body).toMatch(/readiness\s*=\s*'not_connected'::public\.bot_readiness/);
    expect(body).toMatch(/last_checked_at\s*=\s*null/);
  });
});
