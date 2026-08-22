// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");
const ownerId = "00000000-0000-4000-8000-000000000901";
const memberId = "00000000-0000-4000-8000-000000000902";
const otherOwnerId = "00000000-0000-4000-8000-000000000903";
const organizationId = "10000000-0000-4000-8000-000000000901";
const otherOrganizationId = "10000000-0000-4000-8000-000000000902";
const accountId = "20000000-0000-4000-8000-000000000901";
const noVaultAccountId = "20000000-0000-4000-8000-000000000902";
const otherAccountId = "20000000-0000-4000-8000-000000000903";
const firstProjectId = "30000000-0000-4000-8000-000000000901";
const secondProjectId = "30000000-0000-4000-8000-000000000902";
const cutoverProjectId = "30000000-0000-4000-8000-000000000903";
const assignmentRoleId = "40000000-0000-4000-8000-000000000901";
const cutoverRoleId = "40000000-0000-4000-8000-000000000902";
const preExpandLegacySignatures = [
  "public.register_bot(uuid,text,public.bot_provider,text,text,text,text)",
  "public.assign_bot(uuid,uuid,uuid,uuid)",
  "public.assign_bots_to_project(uuid,uuid,jsonb)",
  "public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)",
  "public.set_bot_assignment_execution(uuid,uuid,text,text)",
  "public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)",
  "public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)",
] as const;

async function createPreExpandDatabase(): Promise<PGlite> {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const expandIndex = files.indexOf("20260822000200_register_bot_for_ai_account.sql");
  expect(expandIndex).toBeGreaterThanOrEqual(0);
  for (const file of files.slice(0, expandIndex)) {
    await database.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }
  return database;
}

async function recreateFunctionsWithLineEnding(
  database: PGlite,
  signatures: readonly string[],
  lineEnding: "\n" | "\r\n",
): Promise<void> {
  for (const signature of signatures) {
    const result = await database.query<{ definition: string }>(`
      select pg_get_functiondef($1::regprocedure) as definition
    `, [signature]);
    const definition = result.rows[0].definition.replace(/\r?\n/g, lineEnding);
    await database.exec(definition);
  }
}

describe("exact AI-account bot binding", { timeout: 180_000 }, () => {
  let db: PGlite;

  type BotSnapshot = {
    ai_account_id: string | null;
    base_url: string | null;
    credential_ref: string | null;
    id: string;
    model: string;
    provider: string;
    readiness: string;
    revision: number;
  };

  async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
    try {
      return await work();
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  }

  async function readBotSnapshot(botId: string): Promise<BotSnapshot> {
    await db.exec("reset role");
    const { rows } = await db.query<BotSnapshot>(`
      select id, ai_account_id, provider::text, model, credential_ref, base_url,
             readiness::text, revision
      from public.bots where id = $1::uuid
    `, [botId]);
    return rows[0];
  }

  async function recordReadinessFromSnapshot(
    snapshot: BotSnapshot,
    readiness: "not_connected" | "ready" | "blocked",
    detail: string,
    actorUserId = ownerId,
  ) {
    await db.exec("reset role");
    await db.exec("set role service_role");
    try {
      return await db.query<BotSnapshot>(`
        select id, ai_account_id, provider::text, model, credential_ref, base_url,
               readiness::text, revision
        from public.record_bot_readiness_preserving_disabled(
          $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid,
          $6::public.bot_provider, $7::text, $8::text, $9::text,
          $10::public.bot_readiness, $11::text
        )
      `, [
        organizationId,
        snapshot.id,
        actorUserId,
        Number(snapshot.revision),
        snapshot.ai_account_id,
        snapshot.provider,
        snapshot.model,
        snapshot.credential_ref,
        snapshot.base_url,
        readiness,
        detail,
      ]);
    } finally {
      await db.exec("reset role");
    }
  }

  async function recordReadiness(
    botId: string,
    readiness: "not_connected" | "ready" | "blocked",
    detail: string,
  ) {
    return recordReadinessFromSnapshot(await readBotSnapshot(botId), readiness, detail);
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);
    const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    const expandIndex = files.indexOf("20260822000200_register_bot_for_ai_account.sql");
    expect(expandIndex).toBeGreaterThanOrEqual(0);
    for (const file of files.slice(0, expandIndex + 1)) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values
        ('${ownerId}'), ('${memberId}'), ('${otherOwnerId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Binding Tenant', 'binding-tenant', '${ownerId}'),
        ('${otherOrganizationId}', 'Other Tenant', 'other-binding-tenant', '${otherOwnerId}');
      insert into public.organization_members (organization_id, user_id, role, created_by)
      values ('${organizationId}', '${memberId}', 'member', '${ownerId}');

      insert into public.ai_accounts
        (id, organization_id, provider, auth_method, display_name, status,
         credential_purpose, created_by)
      values
        ('${accountId}', '${organizationId}', 'anthropic', 'subscription',
         'Claude exact', 'connected', 'claude', '${ownerId}'),
        ('${noVaultAccountId}', '${organizationId}', 'anthropic', 'subscription',
         'Claude no vault', 'connected', 'claude_2', '${ownerId}'),
        ('${otherAccountId}', '${otherOrganizationId}', 'anthropic', 'subscription',
         'Other Claude', 'connected', 'claude', '${otherOwnerId}');

      insert into public.provider_credentials
        (organization_id, purpose, sealed_envelope, source, created_by)
      values
        ('${organizationId}', 'claude', 'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'connect_session', '${ownerId}'),
        ('${otherOrganizationId}', 'claude', 'v1.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         'connect_session', '${otherOwnerId}');
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("adopts one unambiguous legacy bot, returns its exact id, and is idempotent", async () => {
    const legacyId = await asUser(ownerId, async () => {
      const { rows } = await db.query<{ id: string }>(`
        select id from public.register_bot(
          $1::uuid, 'Claude legacy', 'anthropic', 'claude-opus-5',
          'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN', null, 'legacy bot'
        )
      `, [organizationId]);
      return rows[0].id;
    });

    const bound = await asUser(ownerId, () => db.query<{
      bot_id: string; provision_outcome: string;
    }>(`
      select * from public.ensure_ai_account_bot(
        $1::uuid, $2::uuid, 'anthropic', 'Claude', 'claude-opus-5', false, null, 'bound bot'
      )
    `, [organizationId, accountId]));
    expect(bound.rows).toEqual([{ bot_id: legacyId, provision_outcome: "bound" }]);

    const replay = await asUser(ownerId, () => db.query<{
      bot_id: string; provision_outcome: string;
    }>(`
      select * from public.ensure_ai_account_bot(
        $1::uuid, $2::uuid, 'anthropic', 'Ignored on replay', 'claude-opus-5', false
      )
    `, [organizationId, accountId]));
    expect(replay.rows).toEqual([{ bot_id: legacyId, provision_outcome: "exists" }]);

    const stored = await db.query<{
      ai_account_id: string; credential_ref: string; provider: string;
    }>("select ai_account_id, credential_ref, provider from public.bots where id = $1", [legacyId]);
    expect(stored.rows[0]).toEqual({
      ai_account_id: accountId,
      credential_ref: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
      provider: "anthropic",
    });

    const audit = await db.query<{ metadata: Record<string, unknown> }>(`
      select metadata from public.activity_events
      where entity_id = $1 and event_type = 'bot.updated'
      order by occurred_at desc limit 1
    `, [legacyId]);
    expect(audit.rows[0].metadata).toMatchObject({
      ai_account_id: accountId,
      ai_account_linked: true,
      credential_reference_present: true,
      provider: "anthropic",
    });
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain("SOFTWAREFACTORY_");
  });

  it("allows an intentional additional bot while retaining exact identity", async () => {
    const result = await asUser(ownerId, () => db.query<{
      bot_id: string; provision_outcome: string;
    }>(`
      select * from public.ensure_ai_account_bot(
        $1::uuid, $2::uuid, 'anthropic', 'Claude reviewer', 'claude-opus-5', true
      )
    `, [organizationId, accountId]));
    expect(result.rows[0].provision_outcome).toBe("created");

    const stored = await db.query<{ ai_account_id: string }>(
      "select ai_account_id from public.bots where id = $1", [result.rows[0].bot_id],
    );
    expect(stored.rows[0].ai_account_id).toBe(accountId);

    const audit = await db.query<{ metadata: Record<string, unknown> }>(`
      select metadata from public.activity_events
      where entity_id = $1 and event_type = 'bot.registered'
      order by occurred_at desc limit 1
    `, [result.rows[0].bot_id]);
    expect(audit.rows[0].metadata).toMatchObject({
      ai_account_id: accountId,
      ai_account_linked: true,
      credential_reference_present: true,
      provider: "anthropic",
    });
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain("SOFTWAREFACTORY_");
  });

  it("fails closed for role, tenant, provider, vault, and binding drift mismatches", async () => {
    await expect(asUser(memberId, () => db.query(`
      select * from public.ensure_ai_account_bot(
        $1::uuid, $2::uuid, 'anthropic', 'Member bot', 'claude-opus-5', false
      )
    `, [organizationId, accountId]))).rejects.toThrow(/owner or admin/i);

    await expect(asUser(ownerId, () => db.query(`
      select * from public.ensure_ai_account_bot(
        $1::uuid, $2::uuid, 'anthropic', 'Cross tenant', 'claude-opus-5', false
      )
    `, [organizationId, otherAccountId]))).rejects.toThrow(/does not exist/i);

    await expect(asUser(ownerId, () => db.query(`
      select * from public.ensure_ai_account_bot(
        $1::uuid, $2::uuid, 'openai', 'Wrong provider', 'gpt-5.4', false
      )
    `, [organizationId, accountId]))).rejects.toThrow(/does not match/i);

    await expect(asUser(ownerId, () => db.query(`
      select * from public.ensure_ai_account_bot(
        $1::uuid, $2::uuid, 'anthropic', 'No vault', 'claude-opus-5', false
      )
    `, [organizationId, noVaultAccountId]))).rejects.toThrow(/no stored credential/i);

    const bot = await db.query<{ id: string }>(
      "select id from public.bots where ai_account_id = $1 order by created_at limit 1",
      [accountId],
    );
    await expect(asUser(ownerId, () => db.query(`
      select * from public.update_bot(
        $1::uuid, $2::uuid, 'Drift attempt', 'claude-opus-5', 'ANTHROPIC_API_KEY', null, null
      )
    `, [organizationId, bot.rows[0].id]))).rejects.toThrow(/must match its AI account/i);
  });

  it("keeps the legacy RPC and both RPC ACLs narrow", async () => {
    const { rows } = await db.query<{
      legacy_authenticated: boolean;
      exact_authenticated: boolean;
      exact_anon: boolean;
      exact_service: boolean;
    }>(`
      select
        has_function_privilege(
          'authenticated',
          'public.register_bot(uuid,text,public.bot_provider,text,text,text,text)',
          'EXECUTE'
        ) as legacy_authenticated,
        has_function_privilege(
          'authenticated',
          'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)',
          'EXECUTE'
        ) as exact_authenticated,
        has_function_privilege(
          'anon',
          'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)',
          'EXECUTE'
        ) as exact_anon,
        has_function_privilege(
          'service_role',
          'public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)',
          'EXECUTE'
        ) as exact_service
    `);
    expect(rows[0]).toEqual({
      legacy_authenticated: true,
      exact_authenticated: true,
      exact_anon: false,
      exact_service: false,
    });
  });

  it("installs the coherence helper and trigger with the exact protected catalog shape", async () => {
    const { rows } = await db.query<{
      helper_secure: boolean;
      helper_public: boolean;
      helper_anon: boolean;
      helper_authenticated: boolean;
      helper_service: boolean;
      trigger_function_secure: boolean;
      trigger_function_public: boolean;
      trigger_function_anon: boolean;
      trigger_function_authenticated: boolean;
      trigger_function_service: boolean;
      trigger_shape: boolean;
    }>(`
      select
        exists (
          select 1 from pg_proc routine
          where routine.oid =
            'public.ai_account_bot_credential_ref(public.bot_provider,text)'::regprocedure
            and routine.prosecdef
            and routine.proconfig @> array['search_path=pg_catalog']::text[]
        ) as helper_secure,
        has_function_privilege(
          'public', 'public.ai_account_bot_credential_ref(public.bot_provider,text)', 'EXECUTE'
        ) as helper_public,
        has_function_privilege(
          'anon', 'public.ai_account_bot_credential_ref(public.bot_provider,text)', 'EXECUTE'
        ) as helper_anon,
        has_function_privilege(
          'authenticated', 'public.ai_account_bot_credential_ref(public.bot_provider,text)', 'EXECUTE'
        ) as helper_authenticated,
        has_function_privilege(
          'service_role', 'public.ai_account_bot_credential_ref(public.bot_provider,text)', 'EXECUTE'
        ) as helper_service,
        exists (
          select 1 from pg_proc routine
          where routine.oid = 'public.enforce_bot_ai_account_binding()'::regprocedure
            and routine.prosecdef
            and routine.proconfig @> array['search_path=pg_catalog']::text[]
        ) as trigger_function_secure,
        has_function_privilege(
          'public', 'public.enforce_bot_ai_account_binding()', 'EXECUTE'
        ) as trigger_function_public,
        has_function_privilege(
          'anon', 'public.enforce_bot_ai_account_binding()', 'EXECUTE'
        ) as trigger_function_anon,
        has_function_privilege(
          'authenticated', 'public.enforce_bot_ai_account_binding()', 'EXECUTE'
        ) as trigger_function_authenticated,
        has_function_privilege(
          'service_role', 'public.enforce_bot_ai_account_binding()', 'EXECUTE'
        ) as trigger_function_service,
        exists (
          select 1 from pg_trigger trigger_row
          where trigger_row.tgrelid = 'public.bots'::regclass
            and trigger_row.tgname = 'bots_ai_account_binding_coherent'
            and not trigger_row.tgisinternal
            and trigger_row.tgenabled = 'O'
            and trigger_row.tgtype = 23
            and trigger_row.tgfoid = 'public.enforce_bot_ai_account_binding()'::regprocedure
            and pg_get_triggerdef(trigger_row.oid) like
              'CREATE TRIGGER bots_ai_account_binding_coherent BEFORE INSERT OR UPDATE OF organization_id, ai_account_id, provider, credential_ref ON public.bots FOR EACH ROW EXECUTE FUNCTION %enforce_bot_ai_account_binding()'
        ) as trigger_shape
    `);
    expect(rows[0]).toEqual({
      helper_secure: true,
      helper_public: false,
      helper_anon: false,
      helper_authenticated: false,
      helper_service: false,
      trigger_function_secure: true,
      trigger_function_public: false,
      trigger_function_anon: false,
      trigger_function_authenticated: false,
      trigger_function_service: false,
      trigger_shape: true,
    });
  });

  it("installs the revision token and checked mutators with narrow catalog identities", async () => {
    const catalog = await db.query<{
      bot_revision_column: boolean;
      bot_revision_constraint: boolean;
      bot_revision_trigger: boolean;
      revision_column: boolean;
      revision_constraint: boolean;
      revision_trigger: boolean;
      checked_functions: boolean;
      checked_acls: boolean;
      legacy_acls: boolean;
      readiness_acl: boolean;
    }>(`
      select
        exists (
          select 1 from pg_attribute column_row
          where column_row.attrelid = 'public.bots'::regclass
            and column_row.attname = 'revision'
            and not column_row.attisdropped
            and column_row.attnotnull
            and column_row.atttypid = 'pg_catalog.int8'::regtype
        ) as bot_revision_column,
        exists (
          select 1 from pg_constraint constraint_row
          where constraint_row.conrelid = 'public.bots'::regclass
            and constraint_row.conname = 'bots_revision_positive'
            and constraint_row.contype = 'c'
        ) as bot_revision_constraint,
        exists (
          select 1 from pg_trigger trigger_row
          where trigger_row.tgrelid = 'public.bots'::regclass
            and trigger_row.tgname = 'bots_increment_revision'
            and not trigger_row.tgisinternal
            and trigger_row.tgenabled = 'O'
            and trigger_row.tgtype = 19
            and trigger_row.tgfoid = 'public.increment_bot_revision()'::regprocedure
        ) as bot_revision_trigger,
        exists (
          select 1 from pg_attribute column_row
          where column_row.attrelid = 'public.bot_assignments'::regclass
            and column_row.attname = 'revision'
            and not column_row.attisdropped
            and column_row.attnotnull
            and column_row.atttypid = 'pg_catalog.int8'::regtype
        ) as revision_column,
        exists (
          select 1 from pg_constraint constraint_row
          where constraint_row.conrelid = 'public.bot_assignments'::regclass
            and constraint_row.conname = 'bot_assignments_revision_positive'
            and constraint_row.contype = 'c'
        ) as revision_constraint,
        exists (
          select 1 from pg_trigger trigger_row
          where trigger_row.tgrelid = 'public.bot_assignments'::regclass
            and trigger_row.tgname = 'bot_assignments_increment_revision'
            and not trigger_row.tgisinternal
            and trigger_row.tgenabled = 'O'
            and trigger_row.tgtype = 19
            and trigger_row.tgfoid =
              'public.increment_bot_assignment_revision()'::regprocedure
        ) as revision_trigger,
        not exists (
          select 1
          from (values
            ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)'),
            ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)'),
            ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)'),
            ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)'),
            ('public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)')
          ) expected(signature)
          left join pg_proc routine on routine.oid = to_regprocedure(expected.signature)
          where routine.oid is null
             or not routine.prosecdef
             or not (routine.proconfig @> array['search_path=pg_catalog']::text[])
        ) as checked_functions,
        not exists (
          select 1
          from (values
            ('public.assign_bots_to_project_checked(uuid,uuid,jsonb)'),
            ('public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)'),
            ('public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)'),
            ('public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)')
          ) expected(signature)
          where not has_function_privilege('authenticated', expected.signature, 'EXECUTE')
             or has_function_privilege('anon', expected.signature, 'EXECUTE')
             or has_function_privilege('public', expected.signature, 'EXECUTE')
             or has_function_privilege('service_role', expected.signature, 'EXECUTE')
        ) as checked_acls,
        not exists (
          select 1
          from (values
            ('public.assign_bot(uuid,uuid,uuid,uuid)'),
            ('public.assign_bots_to_project(uuid,uuid,jsonb)'),
            ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)'),
            ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)'),
            ('public.set_bot_assignment_execution(uuid,uuid,text,text)'),
            ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)')
          ) legacy(signature)
          where not has_function_privilege('authenticated', legacy.signature, 'EXECUTE')
             or has_function_privilege('anon', legacy.signature, 'EXECUTE')
             or has_function_privilege('public', legacy.signature, 'EXECUTE')
             or has_function_privilege('service_role', legacy.signature, 'EXECUTE')
        ) as legacy_acls,
        has_function_privilege(
          'service_role',
          'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
          'EXECUTE'
        )
          and not has_function_privilege(
            'authenticated',
            'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
            'EXECUTE'
          )
          and not has_function_privilege(
            'anon',
            'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
            'EXECUTE'
          )
          and not has_function_privilege(
            'public',
            'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)',
            'EXECUTE'
          ) as readiness_acl
    `);

    expect(catalog.rows[0]).toEqual({
      bot_revision_column: true,
      bot_revision_constraint: true,
      bot_revision_trigger: true,
      revision_column: true,
      revision_constraint: true,
      revision_trigger: true,
      checked_functions: true,
      checked_acls: true,
      legacy_acls: true,
      readiness_acl: true,
    });
  });

  it("keeps the origin/main legacy RPC path operational during migration-first cutover", async () => {
    await db.exec(`
      insert into public.projects (id, organization_id, name, status, created_by)
      values ('${cutoverProjectId}', '${organizationId}', 'Legacy cutover project', 'active', '${ownerId}');
      insert into public.bot_roles
        (id, organization_id, name, slug, summary, instructions, created_by)
      values
        ('${cutoverRoleId}', '${organizationId}', 'Legacy cutover role', 'legacy-cutover-role',
         'Proves the old application remains callable.', 'Use only the legacy compatibility fixture.', '${ownerId}');
    `);

    const bot = await asUser(ownerId, () => db.query<{ id: string }>(`
      select id from public.register_bot(
        $1::uuid, 'Legacy cutover bot', 'openai', 'gpt-5.4',
        'OPENAI_API_KEY', null, 'migration-first compatibility'
      )
    `, [organizationId]));
    const botId = bot.rows[0].id;

    const ready = await asUser(ownerId, () => db.query<{ readiness: string; revision: number }>(`
      select readiness::text, revision from public.record_bot_readiness(
        $1::uuid, $2::uuid, 'ready', 'legacy application readiness check'
      )
    `, [organizationId, botId]));
    expect(ready.rows[0].readiness).toBe("ready");
    expect(Number(ready.rows[0].revision)).toBeGreaterThan(1);

    const assigned = await asUser(ownerId, () => db.query<{ id: string; revision: number }>(`
      select id, revision from public.assign_bot($1::uuid, $2::uuid, $3::uuid, $4::uuid)
    `, [organizationId, botId, cutoverProjectId, cutoverRoleId]));
    expect(Number(assigned.rows[0].revision)).toBe(1);

    const bulk = await asUser(ownerId, () => db.query<{
      id: string; instructions: string; revision: number;
    }>(`
      select id, instructions, revision
      from public.assign_bots_to_project($1::uuid, $2::uuid, $3::jsonb)
    `, [organizationId, cutoverProjectId, JSON.stringify([{
      bot_id: botId,
      role_id: cutoverRoleId,
      instructions: "legacy bulk assignment",
    }])]));
    expect(bulk.rows[0].id).toBe(assigned.rows[0].id);
    expect(bulk.rows[0].instructions).toBe("legacy bulk assignment");
    expect(Number(bulk.rows[0].revision)).toBe(2);

    const configured = await asUser(ownerId, () => db.query<{
      instructions: string; revision: number; status: string;
    }>(`
      select instructions, revision, status::text
      from public.update_bot_assignment_configuration(
        $1::uuid, $2::uuid, '{"instructions":"legacy configuration edit"}'::jsonb,
        $3::uuid, 'paused'
      )
    `, [organizationId, assigned.rows[0].id, cutoverRoleId]));
    expect(configured.rows[0]).toMatchObject({
      instructions: "legacy configuration edit",
      status: "paused",
    });
    expect(Number(configured.rows[0].revision)).toBe(3);

    const execution = await asUser(ownerId, () => db.query<{
      assignment_id: string; model: string; work_effort: string;
    }>(`
      select * from public.set_bot_assignment_execution(
        $1::uuid, $2::uuid, 'gpt-5.4', 'high'
      )
    `, [organizationId, assigned.rows[0].id]));
    expect(execution.rows[0]).toEqual({
      assignment_id: assigned.rows[0].id,
      model: "gpt-5.4",
      work_effort: "high",
    });

    const resumed = await asUser(ownerId, () => db.query<{
      revision: number; status: string;
    }>(`
      select revision, status::text
      from public.update_bot_assignment($1::uuid, $2::uuid, 'active')
    `, [organizationId, assigned.rows[0].id]));
    expect(resumed.rows[0].status).toBe("active");
    expect(Number(resumed.rows[0].revision)).toBe(5);
  });

  it("compares id, project, and revision under lock for assign, configure, execute, and release", async () => {
    await db.exec(`
      insert into public.projects (id, organization_id, name, status, created_by) values
        ('${firstProjectId}', '${organizationId}', 'First posting project', 'active', '${ownerId}'),
        ('${secondProjectId}', '${organizationId}', 'Second posting project', 'active', '${ownerId}');
      insert into public.bot_roles
        (id, organization_id, name, slug, summary, instructions, created_by)
      values
        ('${assignmentRoleId}', '${organizationId}', 'Atomic developer', 'atomic-developer',
         'Exercises atomic posting mutations.', 'Change only the selected posting.', '${ownerId}');
    `);
    const bot = await db.query<{ id: string }>(
      "select id from public.bots where ai_account_id = $1 order by created_at limit 1",
      [accountId],
    );
    const botId = bot.rows[0].id;
    await recordReadiness(botId, "ready", "test readiness");

    const first = await asUser(ownerId, () => db.query<{
      id: string; project_id: string; revision: number;
    }>(`
      select id, project_id, revision
      from public.assign_bots_to_project_checked($1::uuid, $2::uuid, $3::jsonb)
    `, [organizationId, firstProjectId, JSON.stringify([{
      bot_id: botId,
      role_id: assignmentRoleId,
      expected_assignment_id: null,
      expected_project_id: null,
      expected_revision: null,
    }])]));
    expect(first.rows[0].project_id).toBe(firstProjectId);
    expect(Number(first.rows[0].revision)).toBe(1);

    const moved = await asUser(ownerId, () => db.query<{
      id: string; project_id: string; revision: number;
    }>(`
      select id, project_id, revision
      from public.assign_bots_to_project_checked($1::uuid, $2::uuid, $3::jsonb)
    `, [organizationId, secondProjectId, JSON.stringify([{
      bot_id: botId,
      role_id: assignmentRoleId,
      expected_assignment_id: first.rows[0].id,
      expected_project_id: firstProjectId,
      expected_revision: Number(first.rows[0].revision),
    }])]));
    expect(moved.rows[0].id).toBe(first.rows[0].id);
    expect(moved.rows[0].project_id).toBe(secondProjectId);
    expect(Number(moved.rows[0].revision)).toBe(2);

    await expect(asUser(ownerId, () => db.query(`
      select * from public.assign_bots_to_project_checked($1::uuid, $2::uuid, $3::jsonb)
    `, [organizationId, firstProjectId, JSON.stringify([{
      bot_id: botId,
      role_id: assignmentRoleId,
      expected_assignment_id: first.rows[0].id,
      expected_project_id: firstProjectId,
      expected_revision: 1,
    }])]))).rejects.toThrow(/current assignment changed/i);

    const configured = await asUser(ownerId, () => db.query<{ revision: number }>(`
      select revision from public.update_bot_assignment_configuration_checked(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint, '{}'::jsonb, null, 'paused'
      )
    `, [organizationId, first.rows[0].id, secondProjectId, 2]));
    expect(Number(configured.rows[0].revision)).toBe(3);

    await expect(asUser(ownerId, () => db.query(`
      select * from public.assign_bots_to_project_checked($1::uuid, $2::uuid, $3::jsonb)
    `, [organizationId, firstProjectId, JSON.stringify([{
      bot_id: botId,
      role_id: assignmentRoleId,
      expected_assignment_id: first.rows[0].id,
      expected_project_id: secondProjectId,
      expected_revision: 3,
    }])]))).rejects.toThrow(/paused posting must be explicitly resumed/i);
    const stillPaused = await db.query<{
      project_id: string; revision: number; status: string;
    }>(`
      select project_id, revision, status::text
        from public.bot_assignments
       where id = $1::uuid
    `, [first.rows[0].id]);
    expect(stillPaused.rows[0]).toMatchObject({
      project_id: secondProjectId,
      status: "paused",
    });
    expect(Number(stillPaused.rows[0].revision)).toBe(3);

    await expect(asUser(ownerId, () => db.query(`
      select * from public.set_bot_assignment_execution_checked(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint, 'claude-opus-5', 'high'
      )
    `, [organizationId, first.rows[0].id, secondProjectId, 2]))).rejects.toThrow(/posting changed/i);

    const executed = await asUser(ownerId, () => db.query<{ revision: number }>(`
      select revision from public.set_bot_assignment_execution_checked(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint, 'claude-opus-5', 'high'
      )
    `, [organizationId, first.rows[0].id, secondProjectId, 3]));
    expect(Number(executed.rows[0].revision)).toBe(4);

    const rollbackBot = await asUser(ownerId, () => db.query<{ id: string }>(`
      select id from public.register_bot(
        $1::uuid, 'Atomic rollback bot', 'openai', 'gpt-5.4', 'OPENAI_API_KEY', null, null
      )
    `, [organizationId]));
    await recordReadiness(rollbackBot.rows[0].id, "ready", "test readiness");

    await expect(asUser(ownerId, () => db.query(`
      select * from public.assign_bots_to_project_checked($1::uuid, $2::uuid, $3::jsonb)
    `, [organizationId, firstProjectId, JSON.stringify([
      {
        bot_id: rollbackBot.rows[0].id,
        role_id: assignmentRoleId,
        expected_assignment_id: null,
        expected_project_id: null,
        expected_revision: null,
      },
      {
        bot_id: botId,
        role_id: assignmentRoleId,
        expected_assignment_id: first.rows[0].id,
        expected_project_id: secondProjectId,
        expected_revision: 3,
      },
    ])]))).rejects.toThrow(/current assignment changed/i);
    const rolledBack = await db.query<{ count: number }>(`
      select count(*)::integer as count from public.bot_assignments
      where bot_id = $1::uuid and status <> 'released'
    `, [rollbackBot.rows[0].id]);
    expect(rolledBack.rows[0].count).toBe(0);

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
    await db.exec("set role authenticated");
    const competing = await Promise.allSettled([
      db.query<{ revision: number }>(`
        select revision from public.update_bot_assignment_configuration_checked(
          $1::uuid, $2::uuid, $3::uuid, $4::bigint,
          '{"instructions":"first competing edit"}'::jsonb, null, null
        )
      `, [organizationId, first.rows[0].id, secondProjectId, 4]),
      db.query<{ revision: number }>(`
        select revision from public.update_bot_assignment_configuration_checked(
          $1::uuid, $2::uuid, $3::uuid, $4::bigint,
          '{"instructions":"second competing edit"}'::jsonb, null, null
        )
      `, [organizationId, first.rows[0].id, secondProjectId, 4]),
    ]);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(competing.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = competing.find((result) => result.status === "rejected");
    expect(String(rejected?.reason?.message ?? rejected?.reason)).toMatch(/posting changed/i);

    await expect(asUser(ownerId, () => db.query(`
      select * from public.update_bot_assignment_checked(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint, 'released'
      )
    `, [organizationId, first.rows[0].id, firstProjectId, 5]))).rejects.toThrow(/posting changed/i);

    const released = await asUser(ownerId, () => db.query<{
      status: string; project_id: string; revision: number;
    }>(`
      select status, project_id, revision from public.update_bot_assignment_checked(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint, 'released'
      )
    `, [organizationId, first.rows[0].id, secondProjectId, 5]));
    expect(released.rows[0]).toMatchObject({ status: "released", project_id: secondProjectId });
    expect(Number(released.rows[0].revision)).toBe(6);

    await expect(asUser(ownerId, () => db.query(`
      select * from public.update_bot_assignment_configuration_checked(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint,
        '{"instructions":"rewrite history"}'::jsonb, null, 'active'
      )
    `, [organizationId, first.rows[0].id, secondProjectId, 6])))
      .rejects.toThrow(/released posting history is immutable/i);
    await expect(asUser(ownerId, () => db.query(`
      select * from public.update_bot_assignment_checked(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint, 'active'
      )
    `, [organizationId, first.rows[0].id, secondProjectId, 6])))
      .rejects.toThrow(/released posting history is immutable/i);
    await expect(asUser(ownerId, () => db.query(`
      select * from public.set_bot_assignment_execution_checked(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint, 'claude-opus-5', 'max'
      )
    `, [organizationId, first.rows[0].id, secondProjectId, 6])))
      .rejects.toThrow(/released posting history is immutable/i);

    const immutable = await db.query<{ revision: number; status: string }>(`
      select revision, status::text from public.bot_assignments where id = $1::uuid
    `, [first.rows[0].id]);
    expect(immutable.rows[0].status).toBe("released");
    expect(Number(immutable.rows[0].revision)).toBe(6);
  });

  it("makes the checked readiness recorder service-only, rejects stale evidence, and preserves disabled", async () => {
    const bot = await db.query<{ id: string }>(
      "select id from public.bots where ai_account_id = $1 order by created_at limit 1",
      [accountId],
    );
    const botId = bot.rows[0].id;

    const privileges = await db.query<{
      authenticated_execute: boolean;
      service_role_execute: boolean;
      signature: string;
    }>(`
      select expected.signature,
             has_function_privilege('authenticated', expected.signature, 'EXECUTE')
               as authenticated_execute,
             has_function_privilege('service_role', expected.signature, 'EXECUTE')
               as service_role_execute
      from (values
        ('public.assign_bot(uuid,uuid,uuid,uuid)'),
        ('public.assign_bots_to_project(uuid,uuid,jsonb)'),
        ('public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)'),
        ('public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)'),
        ('public.set_bot_assignment_execution(uuid,uuid,text,text)'),
        ('public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)'),
        ('public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)')
      ) expected(signature)
      order by expected.signature
    `);
    expect(privileges.rows).toHaveLength(7);
    expect(privileges.rows.filter((row) => row.authenticated_execute)).toHaveLength(6);
    expect(privileges.rows.find((row) =>
      row.signature.includes("record_bot_readiness_preserving_disabled")
    )?.authenticated_execute).toBe(false);
    expect(privileges.rows.filter((row) => row.service_role_execute)).toEqual([
      expect.objectContaining({
        signature: "public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)",
      }),
    ]);

    const original = await readBotSnapshot(botId);
    await expect(asUser(ownerId, () => db.query(`
      select * from public.record_bot_readiness_preserving_disabled(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid,
        $6::public.bot_provider, $7::text, $8::text, $9::text,
        'ready'::public.bot_readiness, 'browser-forged verdict'
      )
    `, [
      organizationId,
      botId,
      ownerId,
      Number(original.revision),
      original.ai_account_id,
      original.provider,
      original.model,
      original.credential_ref,
      original.base_url,
    ]))).rejects.toThrow(/permission denied/i);

    await expect(recordReadinessFromSnapshot(
      original,
      "ready",
      "invalid actor",
      memberId,
    )).rejects.toThrow(/owner or administrator/i);

    await asUser(ownerId, () => db.query(`
      select * from public.update_bot(
        $1::uuid, $2::uuid, 'Claude exact revised', 'claude-opus-5',
        'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN', null, 'configuration changed'
      )
    `, [organizationId, botId]));
    await expect(recordReadinessFromSnapshot(
      original,
      "ready",
      "stale configuration verdict",
    )).rejects.toThrow(/configuration changed; reload/i);

    const current = await readBotSnapshot(botId);
    const firstWrite = await recordReadinessFromSnapshot(
      current,
      "ready",
      "current credential evidence",
    );
    expect(firstWrite.rows[0].readiness).toBe("ready");
    expect(Number(firstWrite.rows[0].revision)).toBe(Number(current.revision) + 1);
    await expect(recordReadinessFromSnapshot(
      current,
      "blocked",
      "late competing verdict",
    )).rejects.toThrow(/configuration changed; reload/i);

    await db.exec("reset role");
    await db.query(`
      update public.bots
      set readiness = 'disabled'::public.bot_readiness,
          readiness_detail = 'Disabled by an owner.'
      where id = $1::uuid and organization_id = $2::uuid
    `, [botId, organizationId]);
    const disabledSnapshot = await readBotSnapshot(botId);
    const preserved = await recordReadinessFromSnapshot(
      disabledSnapshot,
      "ready",
      "credential recovered",
    );
    expect(preserved.rows[0].readiness).toBe("disabled");
    expect(Number(preserved.rows[0].revision)).toBe(Number(disabledSnapshot.revision));
  });

  it("refuses a replay or partial catalog before replacing functions or triggers", async () => {
    await db.exec("reset role");
    const migration = await readFile(
      resolve(migrationsDirectory, "20260822000200_register_bot_for_ai_account.sql"),
      "utf8",
    );
    await expect(db.exec(migration)).rejects.toThrow(
      /bot account binding function catalog is not clean before the forward migration/i,
    );
  });

  it("refuses a wrong-signature helper before creating any approved object", async () => {
    const driftDb = await createPreExpandDatabase();
    try {
      const migrationFile = "20260822000200_register_bot_for_ai_account.sql";
      await driftDb.exec(`
        create function public.increment_bot_revision(integer)
        returns integer language sql immutable as $$ select $1 $$
      `);

      const migration = await readFile(resolve(migrationsDirectory, migrationFile!), "utf8");
      await expect(driftDb.exec(migration)).rejects.toThrow(
        /bot account binding function catalog is not clean before the forward migration/i,
      );
      const approvedObject = await driftDb.query<{ exists: boolean }>(`
        select to_regprocedure(
          'public.ai_account_bot_credential_ref(public.bot_provider,text)'
        ) is not null as exists
      `);
      expect(approvedObject.rows[0].exists).toBe(false);
    } finally {
      await driftDb.close();
    }
  });

  it("refuses frozen legacy routine drift before creating any EXPAND object", async () => {
    const driftDb = await createPreExpandDatabase();
    try {
      await driftDb.exec(`
        alter function public.assign_bot(uuid,uuid,uuid,uuid) security invoker;
        grant execute on function public.register_bot(
          uuid,text,public.bot_provider,text,text,text,text
        ) to service_role;
      `);
      const migration = await readFile(
        resolve(migrationsDirectory, "20260822000200_register_bot_for_ai_account.sql"),
        "utf8",
      );
      await expect(driftDb.exec(migration)).rejects.toThrow(
        /legacy bot routine catalog does not match the exact authenticated-only pre-EXPAND state/i,
      );
      const catalog = await driftDb.query<{ approved_object_exists: boolean; security_definer: boolean }>(`
        select to_regprocedure(
                 'public.ai_account_bot_credential_ref(public.bot_provider,text)'
               ) is not null as approved_object_exists,
               prosecdef as security_definer
          from pg_proc
         where oid = 'public.assign_bot(uuid,uuid,uuid,uuid)'::regprocedure
      `);
      expect(catalog.rows[0]).toEqual({
        approved_object_exists: false,
        security_definer: false,
      });
    } finally {
      await driftDb.close();
    }
  });

  it("accepts equivalent legacy bodies stored with LF line endings", async () => {
    const lfDb = await createPreExpandDatabase();
    try {
      await recreateFunctionsWithLineEnding(lfDb, preExpandLegacySignatures, "\n");
      const lineEndings = await lfDb.query<{ lf_only_count: number }>(`
        select count(*)::integer as lf_only_count
          from pg_proc
         where oid = any($1::regprocedure[])
           and strpos(prosrc, chr(10)) > 0
           and strpos(prosrc, chr(13)) = 0
      `, [preExpandLegacySignatures]);
      expect(lineEndings.rows[0].lf_only_count).toBe(preExpandLegacySignatures.length);

      await lfDb.exec(await readFile(
        resolve(migrationsDirectory, "20260822000200_register_bot_for_ai_account.sql"),
        "utf8",
      ));
      const catalog = await lfDb.query<{ approved_object_exists: boolean }>(`
        select to_regprocedure(
          'public.ai_account_bot_credential_ref(public.bot_provider,text)'
        ) is not null as approved_object_exists
      `);
      expect(catalog.rows[0].approved_object_exists).toBe(true);
    } finally {
      await lfDb.close();
    }
  });

  it("refuses legacy routine cost drift before creating any EXPAND object", async () => {
    const driftDb = await createPreExpandDatabase();
    try {
      await driftDb.exec(`
        alter function public.assign_bot(uuid,uuid,uuid,uuid) cost 777
      `);
      const migration = await readFile(
        resolve(migrationsDirectory, "20260822000200_register_bot_for_ai_account.sql"),
        "utf8",
      );
      await expect(driftDb.exec(migration)).rejects.toThrow(
        /legacy bot routine catalog does not match the exact authenticated-only pre-EXPAND state/i,
      );
      const catalog = await driftDb.query<{ approved_object_exists: boolean; cost: number }>(`
        select to_regprocedure(
                 'public.ai_account_bot_credential_ref(public.bot_provider,text)'
               ) is not null as approved_object_exists,
               procost as cost
          from pg_proc
         where oid = 'public.assign_bot(uuid,uuid,uuid,uuid)'::regprocedure
      `);
      expect(catalog.rows[0]).toEqual({ approved_object_exists: false, cost: 777 });
    } finally {
      await driftDb.close();
    }
  });

  it("refuses a changed TABLE output type even when identity and body stay unchanged", async () => {
    const driftDb = await createPreExpandDatabase();
    try {
      const { rows } = await driftDb.query<{ definition: string }>(`
        select pg_get_functiondef(
          'public.set_bot_assignment_execution(uuid,uuid,text,text)'::regprocedure
        ) as definition
      `);
      const driftedDefinition = rows[0].definition.replace(
        "RETURNS TABLE(assignment_id uuid, model text, work_effort text)",
        "RETURNS TABLE(assignment_id text, model text, work_effort text)",
      );
      expect(driftedDefinition).not.toBe(rows[0].definition);
      await driftDb.exec(`
        drop function public.set_bot_assignment_execution(uuid,uuid,text,text);
        ${driftedDefinition};
        revoke all on function public.set_bot_assignment_execution(uuid,uuid,text,text)
          from public, anon, authenticated, service_role;
        grant execute on function public.set_bot_assignment_execution(uuid,uuid,text,text)
          to authenticated;
      `);

      const migration = await readFile(
        resolve(migrationsDirectory, "20260822000200_register_bot_for_ai_account.sql"),
        "utf8",
      );
      await expect(driftDb.exec(migration)).rejects.toThrow(
        /legacy bot routine catalog does not match the exact authenticated-only pre-EXPAND state/i,
      );
      const approvedObject = await driftDb.query<{ exists: boolean }>(`
        select to_regprocedure(
          'public.ai_account_bot_credential_ref(public.bot_provider,text)'
        ) is not null as exists
      `);
      expect(approvedObject.rows[0].exists).toBe(false);
    } finally {
      await driftDb.close();
    }
  });

  it("rolls back EXPAND when custom function default privileges add an unexpected executor", async () => {
    const driftDb = await createPreExpandDatabase();
    try {
      await driftDb.exec(`
        create role unexpected_executor nologin;
        alter default privileges for role postgres in schema public
          grant execute on functions to unexpected_executor;
      `);
      const before = await driftDb.query<{ proacl: string | null }>(`
        select proacl::text
          from pg_proc
         where oid = 'public.assign_bot(uuid,uuid,uuid,uuid)'::regprocedure
      `);
      const migration = await readFile(
        resolve(migrationsDirectory, "20260822000200_register_bot_for_ai_account.sql"),
        "utf8",
      );
      await expect(driftDb.exec(migration)).rejects.toThrow(
        /new EXPAND function definition\/security\/ACL catalog is not exact/i,
      );
      const after = await driftDb.query<{
        approved_object_exists: boolean;
        legacy_proacl: string | null;
        revision_exists: boolean;
      }>(`
        select to_regprocedure(
                 'public.ai_account_bot_credential_ref(public.bot_provider,text)'
               ) is not null as approved_object_exists,
               (select proacl::text from pg_proc
                 where oid = 'public.assign_bot(uuid,uuid,uuid,uuid)'::regprocedure) as legacy_proacl,
               exists (
                 select 1 from pg_attribute
                  where attrelid = 'public.bots'::regclass
                    and attname = 'revision'
                    and not attisdropped
               ) as revision_exists
      `);
      expect(after.rows[0]).toEqual({
        approved_object_exists: false,
        legacy_proacl: before.rows[0].proacl,
        revision_exists: false,
      });
    } finally {
      await driftDb.close();
    }
  });

  it("refuses a historically bound non-subscription account before EXPAND DDL", async () => {
    const driftDb = await createPreExpandDatabase();
    try {
      const historicalOwner = "00000000-0000-4000-8000-000000000991";
      const historicalOrganization = "10000000-0000-4000-8000-000000000991";
      const historicalAccount = "20000000-0000-4000-8000-000000000991";
      await driftDb.exec(`
        insert into auth.users (id) values ('${historicalOwner}');
        insert into public.organizations (id, name, slug, created_by)
        values ('${historicalOrganization}', 'Historical Drift', 'historical-drift', '${historicalOwner}');
        insert into public.ai_accounts
          (id, organization_id, provider, auth_method, display_name, status,
           credential_purpose, created_by)
        values
          ('${historicalAccount}', '${historicalOrganization}', 'anthropic', 'api_key',
           'Wrong auth method', 'connected', 'claude', '${historicalOwner}');
        insert into public.bots
          (organization_id, name, provider, model, credential_ref, ai_account_id, created_by)
        values
          ('${historicalOrganization}', 'Historically bound bot', 'anthropic', 'claude-opus-5',
           'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN', '${historicalAccount}', '${historicalOwner}');
      `);
      const migration = await readFile(
        resolve(migrationsDirectory, "20260822000200_register_bot_for_ai_account.sql"),
        "utf8",
      );
      await expect(driftDb.exec(migration)).rejects.toThrow(
        /existing bot and AI account bindings are inconsistent before EXPAND/i,
      );
      const catalog = await driftDb.query<{ exists: boolean }>(`
        select to_regprocedure(
          'public.ai_account_bot_credential_ref(public.bot_provider,text)'
        ) is not null as exists
      `);
      expect(catalog.rows[0].exists).toBe(false);
    } finally {
      await driftDb.close();
    }
  });

  it("refuses a historically bound cross-tenant account before EXPAND DDL", async () => {
    const driftDb = await createPreExpandDatabase();
    try {
      const firstOwner = "00000000-0000-4000-8000-000000000981";
      const secondOwner = "00000000-0000-4000-8000-000000000982";
      const firstOrganization = "10000000-0000-4000-8000-000000000981";
      const secondOrganization = "10000000-0000-4000-8000-000000000982";
      const secondAccount = "20000000-0000-4000-8000-000000000982";
      await driftDb.exec(`
        alter table public.bots drop constraint bots_ai_account_fk;
        insert into auth.users (id) values ('${firstOwner}'), ('${secondOwner}');
        insert into public.organizations (id, name, slug, created_by) values
          ('${firstOrganization}', 'First Historical Tenant', 'first-historical-tenant', '${firstOwner}'),
          ('${secondOrganization}', 'Second Historical Tenant', 'second-historical-tenant', '${secondOwner}');
        insert into public.ai_accounts
          (id, organization_id, provider, auth_method, display_name, status,
           credential_purpose, created_by)
        values
          ('${secondAccount}', '${secondOrganization}', 'anthropic', 'subscription',
           'Other tenant account', 'connected', 'claude', '${secondOwner}');
        insert into public.bots
          (organization_id, name, provider, model, credential_ref, ai_account_id, created_by)
        values
          ('${firstOrganization}', 'Cross-tenant historical bot', 'anthropic', 'claude-opus-5',
           'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN', '${secondAccount}', '${firstOwner}');
      `);
      const migration = await readFile(
        resolve(migrationsDirectory, "20260822000200_register_bot_for_ai_account.sql"),
        "utf8",
      );
      await expect(driftDb.exec(migration)).rejects.toThrow(
        /existing bot and AI account bindings are inconsistent before EXPAND/i,
      );
      const catalog = await driftDb.query<{ exists: boolean }>(`
        select to_regprocedure(
          'public.ai_account_bot_credential_ref(public.bot_provider,text)'
        ) is not null as exists
      `);
      expect(catalog.rows[0].exists).toBe(false);
    } finally {
      await driftDb.close();
    }
  });
});
