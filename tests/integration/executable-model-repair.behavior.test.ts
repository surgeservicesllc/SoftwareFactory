// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The repair, run against the real migration chain.
 *
 * The rows are seeded *before* the repair migration is applied, so this is the
 * upgrade a live workspace actually experiences rather than a fresh install
 * that never had the defect. What it has to prove is that a Codex bot which
 * could not be routed yesterday can be routed today, and that the repair did
 * not reach past the rows the console itself wrote.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");
const repairMigration = "20260822000600_route_bots_onto_the_executable_model.sql";
const EXECUTABLE_MODEL = "gpt-5.3-codex";

const ownerId = "00000000-0000-4000-8000-0000000005a1";
const organizationId = "10000000-0000-4000-8000-0000000005b1";
const projectId = "40000000-0000-4000-8000-0000000005c1";
const roleId = "50000000-0000-4000-8000-0000000005d1";

const staleBotId = "60000000-0000-4000-8000-0000000005e1";
const handTypedBotId = "60000000-0000-4000-8000-0000000005e2";
const anthropicBotId = "60000000-0000-4000-8000-0000000005e3";
const alreadyGoodBotId = "60000000-0000-4000-8000-0000000005e4";

describe("moving existing bots onto the executable model", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid()
      returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt()
      returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    // Everything up to, but not including, the repair.
    for (const migrationFile of migrationFiles) {
      if (migrationFile === repairMigration) break;
      await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }

    // A workspace as the console actually left it.
    await db.exec(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Codex Tenant', 'codex-tenant', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, github_repository, default_branch, created_by)
        values ('${projectId}', '${organizationId}', 'Factory', 'active', 'tenant/app', 'main', '${ownerId}');
      insert into public.bot_roles (id, organization_id, slug, name, summary, instructions, risk_ceiling, created_by)
        values ('${roleId}', '${organizationId}', 'builder', 'Builder',
                'Builds what the command asks for.',
                'Implement the requested change and open a draft pull request.',
                'green', '${ownerId}');

      insert into public.bots (id, organization_id, name, provider, model, created_by) values
        ('${staleBotId}', '${organizationId}', 'Codex 1', 'openai', 'gpt-5.1-codex', '${ownerId}'),
        ('${handTypedBotId}', '${organizationId}', 'Codex hand', 'openai', 'gpt-4.1-private', '${ownerId}'),
        ('${anthropicBotId}', '${organizationId}', 'Claude 1', 'anthropic', 'claude-opus-5', '${ownerId}'),
        ('${alreadyGoodBotId}', '${organizationId}', 'Codex ok', 'openai', '${EXECUTABLE_MODEL}', '${ownerId}');

      insert into public.bot_assignments (organization_id, bot_id, project_id, role_id, status, model, created_by) values
        ('${organizationId}', '${staleBotId}', '${projectId}', '${roleId}', 'active', 'o4-mini', '${ownerId}'),
        ('${organizationId}', '${alreadyGoodBotId}', '${projectId}', '${roleId}', 'active', null, '${ownerId}');
    `);

    await db.exec(await readFile(resolve(migrationsDirectory, repairMigration), "utf8"));
  }, 240_000);

  afterAll(async () => {
    await db.close();
  });

  async function modelOf(botId: string) {
    const result = await db.query<{ model: string }>(
      "select model from public.bots where id = $1",
      [botId],
    );
    return result.rows[0]?.model;
  }

  it("moves a Codex bot the console provisioned onto the model the executor accepts", async () => {
    expect(await modelOf(staleBotId)).toBe(EXECUTABLE_MODEL);
  });

  it("leaves a model the console never offered alone, rather than rewriting a choice", async () => {
    // It still cannot execute — but the refusal now says so, and inventing an
    // intention on someone's behalf is the worse of the two failures.
    expect(await modelOf(handTypedBotId)).toBe("gpt-4.1-private");
  });

  it("does not touch another provider's bots", async () => {
    expect(await modelOf(anthropicBotId)).toBe("claude-opus-5");
  });

  it("leaves an already-correct bot exactly as it was", async () => {
    expect(await modelOf(alreadyGoodBotId)).toBe(EXECUTABLE_MODEL);
  });

  it("clears a posting override that named a model no worker can claim", async () => {
    const overrides = await db.query<{ model: string | null }>(
      "select model from public.bot_assignments where bot_id = $1",
      [staleBotId],
    );
    // Null, not the executable model: null means "the bot's model", which is
    // now right, and asserting the person asked for a specific one would be
    // a claim nobody made.
    expect(overrides.rows[0]?.model).toBeNull();
  });

  it("records every repair as an activity event naming what moved and why", async () => {
    const events = await db.query<{
      entity_type: string;
      description: string;
      metadata: { previous_model?: string; model?: string | null; reason?: string };
    }>(
      `select entity_type, description, metadata
       from public.activity_events
       where metadata ->> 'reason' = 'provider_model_mismatch_repair'
       order by entity_type asc`,
    );

    expect(events.rows).toHaveLength(2);
    const assignmentEvent = events.rows.find((row) => row.entity_type === "bot_assignment");
    const botEvent = events.rows.find((row) => row.entity_type === "bot");
    expect(botEvent?.metadata.previous_model).toBe("gpt-5.1-codex");
    expect(botEvent?.metadata.model).toBe(EXECUTABLE_MODEL);
    expect(assignmentEvent?.metadata.previous_model).toBe("o4-mini");
    expect(assignmentEvent?.metadata.model).toBeNull();
  });

  it("leaves the repaired bot routable, which is the whole point", async () => {
    // The effective model the routing projection and `submit_factory_command`
    // both compute: coalesce(assignment.model, bot.model).
    const effective = await db.query<{ effective_model: string; provider: string }>(
      `select coalesce(assignment.model, bot.model) as effective_model,
              bot.provider::text as provider
       from public.bot_assignments assignment
       join public.bots bot on bot.id = assignment.bot_id
       where assignment.bot_id = $1`,
      [staleBotId],
    );
    expect(effective.rows[0]).toEqual({
      effective_model: EXECUTABLE_MODEL,
      provider: "openai",
    });
  });

  it("is safe to run twice, because a repair that cannot be replayed is not a repair", async () => {
    await db.exec(await readFile(resolve(migrationsDirectory, repairMigration), "utf8"));
    const events = await db.query<{ total: number }>(
      `select count(*)::int as total from public.activity_events
       where metadata ->> 'reason' = 'provider_model_mismatch_repair'`,
    );
    // Nothing matches the stale set any more, so the second run writes nothing.
    expect(events.rows[0]?.total).toBe(2);
    expect(await modelOf(staleBotId)).toBe(EXECUTABLE_MODEL);
  });
});
