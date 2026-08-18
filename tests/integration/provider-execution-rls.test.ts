// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");

const providerTables = [
  "provider_model_configurations",
  "provider_agent_assignments",
  "provider_routing_decisions",
  "provider_run_events",
] as const;

const ownerOneId = "00000000-0000-4000-8000-000000000101";
const adminOneId = "00000000-0000-4000-8000-000000000102";
const memberOneId = "00000000-0000-4000-8000-000000000103";
const ownerTwoId = "00000000-0000-4000-8000-000000000201";

const organizationOneId = "10000000-0000-4000-8000-000000000001";
const organizationTwoId = "10000000-0000-4000-8000-000000000002";
const projectOneId = "40000000-0000-4000-8000-000000000001";
const projectTwoId = "40000000-0000-4000-8000-000000000002";
const taskOneId = "80000000-0000-4000-8000-000000000001";
const taskTwoId = "80000000-0000-4000-8000-000000000002";
type ApplicationRole = "anon" | "authenticated" | "service_role";

async function source(path: string) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

async function assumeRole(db: PGlite, role: ApplicationRole, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

const recordRunSql = `
  select routing_decision_id, agent_run_id
  from public.record_provider_run(
    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::public.risk_level,
    $7::text, $8::text, $9::text, $10::text, $11::text, $12::text,
    $13::jsonb, $14::jsonb, $15::text, $16::public.run_status, $17::text,
    $18::jsonb, $19::jsonb, $20::jsonb, $21::integer, $22::text, $23::jsonb
  )
`;

function runArguments(overrides: Partial<Record<number, unknown>> = {}): unknown[] {
  const base: unknown[] = [
    organizationOneId,
    projectOneId,
    taskOneId,
    null, // agent id, filled by the caller
    "implementation_review",
    "green",
    "AUTO",
    "phase2a-routing-v1",
    "ROUTED",
    "AUTO_SCORE",
    "anthropic",
    "claude-opus-5",
    JSON.stringify([{ code: "AUTO_SCORE_SELECTED", provider: "anthropic", detail: "highest score" }]),
    JSON.stringify([{ provider: "anthropic", eligible: true, score: 0.81 }]),
    null,
    "succeeded",
    "msg_reference_01",
    JSON.stringify({ task_kind: "implementation_review" }),
    JSON.stringify({ summary: "No blocking defects found.", confidence: "high" }),
    JSON.stringify({ input_tokens: 1200, output_tokens: 420, estimated_cost_micros: 16500 }),
    4200,
    null,
    JSON.stringify([
      { type: "run_created", message: "Run created." },
      { type: "run_succeeded", message: "Structured result validated." },
    ]),
  ];
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value;
  }
  return base;
}

describe("Phase 2A provider execution layer", () => {
  let db: PGlite;
  let reviewerAgentId: string;
  let implementerAgentId: string;

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

    const migrationFiles = (await readdir(migrationsRoot))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    expect(migrationFiles.at(-1)).toBe("20260818000200_seed_standard_model_catalogue.sql");
    for (const migrationFile of migrationFiles) {
      await db.exec(await source(`supabase/migrations/${migrationFile}`));
    }

    await db.exec(`
      insert into auth.users (id) values
        ('${ownerOneId}'), ('${adminOneId}'), ('${memberOneId}'), ('${ownerTwoId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationOneId}', 'Provider Factory One', 'provider-factory-one', '${ownerOneId}'),
        ('${organizationTwoId}', 'Provider Factory Two', 'provider-factory-two', '${ownerTwoId}');

      insert into public.organization_members (organization_id, user_id, role, created_by) values
        ('${organizationOneId}', '${adminOneId}', 'admin', '${ownerOneId}'),
        ('${organizationOneId}', '${memberOneId}', 'member', '${ownerOneId}');

      insert into public.projects (id, organization_id, name, status, created_by) values
        ('${projectOneId}', '${organizationOneId}', 'Tenant One Project', 'active', '${ownerOneId}'),
        ('${projectTwoId}', '${organizationTwoId}', 'Tenant Two Project', 'active', '${ownerTwoId}');

      insert into public.tasks (id, organization_id, project_id, title, created_by) values
        ('${taskOneId}', '${organizationOneId}', '${projectOneId}', 'Review the change', '${ownerOneId}'),
        ('${taskTwoId}', '${organizationTwoId}', '${projectTwoId}', 'Review the change', '${ownerTwoId}');
    `);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("keeps row security and force row security on every new table", async () => {
    await resetRole(db);
    const result = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity
       from pg_class
       where relnamespace = 'public'::regnamespace and relname = any($1)`,
      [providerTables as unknown as string[]],
    );

    expect(result.rows).toHaveLength(providerTables.length);
    for (const row of result.rows) {
      expect(row.relrowsecurity, `${row.relname} row security`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} force row security`).toBe(true);
    }
  });

  it("defaults outbound provider execution to off", async () => {
    await resetRole(db);
    const result = await db.query<{ ai_provider_execution_enabled: boolean }>(
      "select ai_provider_execution_enabled from public.organizations where id = $1",
      [organizationOneId],
    );
    expect(result.rows[0]?.ai_provider_execution_enabled).toBe(false);
  });

  it("grants authenticated catalogue select only, never raw evidence or direct writes", async () => {
    await resetRole(db);
    const result = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type
       from information_schema.role_table_grants
       where grantee = 'authenticated' and table_schema = 'public' and table_name = any($1)`,
      [providerTables as unknown as string[]],
    );

    const granted = new Set(result.rows.map((row) => `${row.table_name}:${row.privilege_type}`));
    for (const table of providerTables) {
      expect(granted.has(`${table}:SELECT`), `${table} select`).toBe(
        table === "provider_model_configurations",
      );
      for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
        expect(granted.has(`${table}:${privilege}`), `${table} ${privilege}`).toBe(false);
      }
    }
  });

  it("seeds the logical agent roster for a manager and is idempotent", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const first = await db.query<{ id: string; name: string; provider: string | null }>(
      "select id, name, provider from public.ensure_default_agents($1)",
      [organizationOneId],
    );
    expect(first.rows.length).toBeGreaterThanOrEqual(11);
    expect(first.rows.every((row) => row.provider === null)).toBe(true);

    const second = await db.query<{ id: string }>(
      "select id from public.ensure_default_agents($1)",
      [organizationOneId],
    );
    expect(second.rows).toHaveLength(first.rows.length);

    reviewerAgentId = first.rows.find((row) => row.name === "Security")!.id;
    implementerAgentId = first.rows.find((row) => row.name === "Backend")!.id;
    expect(reviewerAgentId).toBeTruthy();
    expect(implementerAgentId).toBeTruthy();
  });

  it("denies agent seeding to a plain member and to anonymous callers", async () => {
    await assumeRole(db, "authenticated", memberOneId);
    await expect(
      db.query("select * from public.ensure_default_agents($1)", [organizationOneId]),
    ).rejects.toThrow(/owner or administrator/i);

    await assumeRole(db, "anon", null);
    await expect(
      db.query("select * from public.ensure_default_agents($1)", [organizationOneId]),
    ).rejects.toThrow();
  });

  it("configures models, enforces one default per provider, and rejects members", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    await db.query(
      "select * from public.upsert_provider_model_configuration($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        organizationOneId, "anthropic", "claude-opus-5", "Claude Opus 5",
        JSON.stringify(["planning", "code_review"]), true, true, 5_000_000, 25_000_000,
      ],
    );
    await db.query(
      "select * from public.upsert_provider_model_configuration($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        organizationOneId, "anthropic", "claude-sonnet-5", "Claude Sonnet 5",
        JSON.stringify(["planning"]), true, true, 3_000_000, 15_000_000,
      ],
    );

    const defaults = await db.query<{ model: string }>(
      `select model from public.provider_model_configurations
       where organization_id = $1 and provider = 'anthropic' and is_default`,
      [organizationOneId],
    );
    expect(defaults.rows).toHaveLength(1);
    expect(defaults.rows[0]?.model).toBe("claude-sonnet-5");

    await assumeRole(db, "authenticated", memberOneId);
    await expect(
      db.query(
        "select * from public.upsert_provider_model_configuration($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [organizationOneId, "openai", "some-model", "Some Model", JSON.stringify([]), true, false, null, null],
      ),
    ).rejects.toThrow(/owner or administrator/i);
  });

  it("rejects a non-AI provider in the model catalogue", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    await expect(
      db.query(
        "select * from public.upsert_provider_model_configuration($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [organizationOneId, "github", "gh", "GitHub", JSON.stringify([]), true, false, null, null],
      ),
    ).rejects.toThrow(/anthropic or openai/i);
  });

  it("rejects credential-shaped model catalogue identifiers and labels", async () => {
    const secretLike = `sk-${"a".repeat(30)}`;
    await assumeRole(db, "authenticated", ownerOneId);

    await expect(
      db.query(
        "select * from public.upsert_provider_model_configuration($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [organizationOneId, "openai", secretLike, "Unsafe model", JSON.stringify([]), true, false, null, null],
      ),
    ).rejects.toThrow(/provider_model_configurations_text_not_secret/i);

    await expect(
      db.query(
        "select * from public.upsert_provider_model_configuration($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [organizationOneId, "openai", "safe-model", secretLike, JSON.stringify([]), true, false, null, null],
      ),
    ).rejects.toThrow(/provider_model_configurations_text_not_secret/i);

    await resetRole(db);
    await expect(db.query(
      `insert into public.provider_model_configurations
         (organization_id,provider,model,display_name,capabilities,created_by)
       values ($1,'openai',$2,'Unsafe direct model','[]'::jsonb,$3)`,
      [organizationOneId, secretLike, ownerOneId],
    )).rejects.toThrow(/provider_model_configurations_text_not_secret/i);

    const persisted = await db.query<{ count: string }>(`
      select count(*)::text as count
      from public.provider_model_configurations
      where organization_id = $1 and (model = $2 or display_name = $2)
    `, [organizationOneId, secretLike]);
    expect(persisted.rows[0]?.count).toBe("0");

    const constraint = await db.query<{ definition: string }>(`
      select pg_catalog.pg_get_constraintdef(oid) as definition
      from pg_catalog.pg_constraint
      where conname = 'provider_model_configurations_text_not_secret'
        and conrelid = 'public.provider_model_configurations'::regclass
    `);
    expect(constraint.rows).toHaveLength(1);
    expect(constraint.rows[0]?.definition).toContain("text_has_likely_secret(model)");
    expect(constraint.rows[0]?.definition).toContain("text_has_likely_secret(display_name)");
  });

  it("binds an agent to a provider and refuses an unconfigured model", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const assigned = await db.query<{ provider: string | null; model: string | null }>(
      "select provider, model from public.set_agent_provider_assignment($1,$2,$3)",
      [reviewerAgentId, "anthropic", "claude-opus-5"],
    );
    expect(assigned.rows[0]).toEqual({ provider: "anthropic", model: "claude-opus-5" });

    await resetRole(db);
    const neutralAgent = await db.query<{ provider: string | null; model: string | null }>(
      "select provider, model from public.agents where id = $1",
      [reviewerAgentId],
    );
    expect(neutralAgent.rows[0]).toEqual({ provider: null, model: null });

    await assumeRole(db, "authenticated", ownerOneId);

    await expect(
      db.query("select * from public.set_agent_provider_assignment($1,$2,$3)", [
        reviewerAgentId,
        "anthropic",
        "model-that-was-never-configured",
      ]),
    ).rejects.toThrow(/not an enabled configuration/i);

    const cleared = await db.query<{ provider: string | null; model: string | null }>(
      "select provider, model from public.set_agent_provider_assignment($1,$2,$3)",
      [reviewerAgentId, null, null],
    );
    expect(cleared.rows[0]).toEqual({ provider: null, model: null });

    // Restore the binding for the remaining assertions.
    await db.query("select * from public.set_agent_provider_assignment($1,$2,$3)", [
      reviewerAgentId,
      "anthropic",
      "claude-opus-5",
    ]);
  });

  it("preserves the catalogue's 128-character model contract for assignments and runs", async () => {
    const model = `m${"x".repeat(127)}`;
    await assumeRole(db, "authenticated", ownerOneId);
    await db.query(
      "select * from public.upsert_provider_model_configuration($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        organizationOneId, "openai", model, "Long model identifier",
        JSON.stringify(["implementation"]), true, false, null, null,
      ],
    );
    const assigned = await db.query<{ model: string | null }>(
      "select model from public.set_agent_provider_assignment($1,$2,$3)",
      [implementerAgentId, "openai", model],
    );
    expect(assigned.rows[0]?.model).toBe(model);

    await db.query("select * from public.set_provider_execution_enabled($1,$2)", [
      organizationOneId, true,
    ]);
    const recorded = await db.query<{ agent_run_id: string }>(
      recordRunSql,
      runArguments({
        3: implementerAgentId,
        10: "openai",
        11: model,
        13: JSON.stringify([{
          provider: "openai",
          model,
          eligible: true,
          score: 0.75,
          ineligibleReasons: [],
        }]),
      }),
    );
    await assumeRole(db, "authenticated", memberOneId);
    const detail = await db.query<{
      detail: { model: string; routing: { candidates: Array<{ model: string }> } };
    }>("select detail from public.get_agent_run_detail($1,$2)", [
      organizationOneId, recorded.rows[0]!.agent_run_id,
    ]);
    expect(detail.rows[0]?.detail.model).toBe(model);
    expect(detail.rows[0]?.detail.routing.candidates[0]?.model).toBe(model);
    await assumeRole(db, "authenticated", ownerOneId);
    await db.query("select * from public.set_provider_execution_enabled($1,$2)", [
      organizationOneId, false,
    ]);
  });

  it("restricts the execution switch to an owner", async () => {
    await assumeRole(db, "authenticated", adminOneId);
    await expect(
      db.query("select * from public.set_provider_execution_enabled($1,$2)", [organizationOneId, true]),
    ).rejects.toThrow(/only an organization owner/i);

    await assumeRole(db, "authenticated", ownerOneId);
    const enabled = await db.query<{ ai_provider_execution_enabled: boolean }>(
      "select ai_provider_execution_enabled from public.set_provider_execution_enabled($1,$2)",
      [organizationOneId, true],
    );
    expect(enabled.rows[0]?.ai_provider_execution_enabled).toBe(true);

    await db.query("select * from public.set_provider_execution_enabled($1,$2)", [
      organizationOneId,
      false,
    ]);
  });

  it("records a routed run with its evidence, trace, and activity event", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    await db.query("select * from public.set_provider_execution_enabled($1,$2)", [
      organizationOneId,
      true,
    ]);
    const recorded = await db.query<{ routing_decision_id: string; agent_run_id: string }>(
      recordRunSql,
      runArguments({ 3: reviewerAgentId }),
    );

    const { routing_decision_id: routingId, agent_run_id: runId } = recorded.rows[0]!;
    expect(routingId).toBeTruthy();
    expect(runId).toBeTruthy();

    await resetRole(db);

    const run = await db.query<{
      provider: string;
      model: string;
      status: string;
      latency_ms: number;
      routing_decision_id: string;
    }>(
      "select provider, model, status, latency_ms, routing_decision_id from public.agent_runs where id = $1",
      [runId],
    );
    expect(run.rows[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5",
      status: "succeeded",
      latency_ms: 4200,
      routing_decision_id: routingId,
    });

    const commonDimensions = await db.query<{ risk_level: string; logical_agent_role: string }>(
      "select risk_level, logical_agent_role from public.agent_runs where id = $1",
      [runId],
    );
    expect(commonDimensions.rows[0]).toEqual({
      risk_level: "green",
      logical_agent_role: "security",
    });

    const events = await db.query<{ sequence: number; event_type: string }>(
      "select sequence, event_type from public.provider_run_events where agent_run_id = $1 order by sequence",
      [runId],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual(["run_created", "run_succeeded"]);

    const activity = await db.query<{ entity_type: string; description: string }>(
      "select entity_type, description from public.activity_events where entity_id = $1",
      [runId],
    );
    expect(activity.rows[0]?.entity_type).toBe("provider_agent_run");
    expect(activity.rows[0]?.description).toContain("succeeded");

    await assumeRole(db, "authenticated", memberOneId);
    const detail = await db.query<{
      detail: {
        command: null;
        routing: {
          candidates: Array<{
            eligible: boolean;
            ineligibleReasons: string[];
            model: string | null;
            provider: string;
            score: number | null;
          }>;
          policyVersion: string;
          reasons: Array<{ code: string; detail: string; provider: string | null }>;
          source: string | null;
        };
      };
    }>("select detail from public.get_agent_run_detail($1,$2)", [organizationOneId, runId]);
    expect(detail.rows[0]?.detail).toMatchObject({
      command: null,
      routing: {
        candidates: [{
          eligible: true,
          ineligibleReasons: [],
          model: null,
          provider: "anthropic",
          score: 0.81,
        }],
        policyVersion: "phase2a-routing-v1",
        reasons: [{
          code: "AUTO_SCORE_SELECTED",
          detail: "highest score",
          provider: "anthropic",
        }],
        source: "AUTO_SCORE",
      },
    });
  });

  it("bounds malformed-but-storable Phase 2A routing evidence for the browser", async () => {
    const longDetail = "x".repeat(501);
    const longModel = "m".repeat(128);
    await assumeRole(db, "authenticated", ownerOneId);
    const recorded = await db.query<{ agent_run_id: string }>(
      recordRunSql,
      runArguments({
        3: implementerAgentId,
        7: "phase2a:routing:v1",
        12: JSON.stringify([
          { code: "AUTO_SCORE_SELECTED", provider: "not-a-provider", detail: longDetail },
          { code: "NOT_ALLOWLISTED", provider: "anthropic", detail: "must be omitted" },
        ]),
        13: JSON.stringify([
          {
            provider: "openai",
            model: longModel,
            eligible: true,
            score: 7,
            ineligibleReasons: ["MODEL_NOT_AVAILABLE", "NOT_ALLOWLISTED"],
          },
          { provider: "not-a-provider", eligible: true, score: 0.5 },
        ]),
      }),
    );
    const runId = recorded.rows[0]!.agent_run_id;

    await assumeRole(db, "authenticated", memberOneId);
    const detail = await db.query<{
      detail: {
        routing: {
          candidates: Array<Record<string, unknown>>;
          policyVersion: string;
          reasons: Array<Record<string, unknown>>;
        };
      };
    }>("select detail from public.get_agent_run_detail($1,$2)", [organizationOneId, runId]);
    expect(detail.rows[0]?.detail.routing).toEqual({
      candidates: [{
        eligible: true,
        ineligibleReasons: ["MODEL_NOT_AVAILABLE"],
        model: longModel,
        provider: "openai",
        score: null,
      }],
      policyVersion: "redacted",
      reasons: [{
        code: "AUTO_SCORE_SELECTED",
        detail: "Routing evidence detail was omitted by the bounded projection.",
        provider: null,
      }],
      source: "AUTO_SCORE",
    });
  });

  it("records a blocked decision without manufacturing a run", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const blocked = await db.query<{ routing_decision_id: string; agent_run_id: string | null }>(
      recordRunSql,
      runArguments({
        3: reviewerAgentId,
        8: "NO_PROVIDER_AVAILABLE",
        9: null,
        10: null,
        11: null,
      }),
    );

    expect(blocked.rows[0]?.routing_decision_id).toBeTruthy();
    expect(blocked.rows[0]?.agent_run_id).toBeNull();
  });

  it("rejects run evidence carrying sensitive data or a likely secret", async () => {
    await assumeRole(db, "authenticated", ownerOneId);

    await expect(
      db.query(recordRunSql, runArguments({
        3: reviewerAgentId,
        18: JSON.stringify({ api_key: "value" }),
      })),
    ).rejects.toThrow(/sensitive data/i);

    await expect(
      db.query(recordRunSql, runArguments({
        3: reviewerAgentId,
        7: `sk-${"p".repeat(30)}`,
      })),
    ).rejects.toThrow(/provider_routing_decisions_policy_version_not_secret/i);

    await resetRole(db);
    const routingPolicyConstraint = await db.query<{ definition: string }>(`
      select pg_catalog.pg_get_constraintdef(oid) as definition
      from pg_catalog.pg_constraint
      where conname = 'provider_routing_decisions_policy_version_not_secret'
        and conrelid = 'public.provider_routing_decisions'::regclass
    `);
    expect(routingPolicyConstraint.rows).toHaveLength(1);
    expect(routingPolicyConstraint.rows[0]?.definition).toContain(
      "text_has_likely_secret(policy_version)",
    );

    const secretLikeModel = `sk-${"m".repeat(30)}`;
    await expect(db.query(
      "update public.provider_agent_assignments set model = $1 where agent_id = $2",
      [secretLikeModel, reviewerAgentId],
    )).rejects.toThrow(/provider_agent_assignments_model_not_secret/i);
    await expect(db.query(
      `update public.provider_routing_decisions set selected_model = $1
       where organization_id = $2 and selected_model is not null`,
      [secretLikeModel, organizationOneId],
    )).rejects.toThrow(/provider_routing_decisions_selected_model_not_secret/i);

    const scalarModelConstraints = await db.query<{ conname: string; definition: string }>(`
      select conname, pg_catalog.pg_get_constraintdef(oid) as definition
      from pg_catalog.pg_constraint
      where conname in (
        'provider_agent_assignments_model_not_secret',
        'provider_routing_decisions_selected_model_not_secret'
      )
      order by conname
    `);
    expect(scalarModelConstraints.rows).toHaveLength(2);
    expect(scalarModelConstraints.rows.every((row) =>
      row.definition.includes("text_has_likely_secret"),
    )).toBe(true);
    const scalarPersistence = await db.query<{ count: string }>(`
      select (
        (select count(*) from public.provider_agent_assignments where model = $1)
        + (select count(*) from public.provider_routing_decisions where selected_model = $1)
      )::text as count
    `, [secretLikeModel]);
    expect(scalarPersistence.rows[0]?.count).toBe("0");

    await assumeRole(db, "authenticated", ownerOneId);
    await expect(
      db.query(recordRunSql, runArguments({
        3: reviewerAgentId,
        21: "failed while using sk-abcdefghijklmnopqrstuvwxyz012345",
      })),
    ).rejects.toThrow(/likely secret/i);
  });

  it("refuses to record a run against another tenant's task or a foreign agent", async () => {
    await assumeRole(db, "authenticated", ownerOneId);

    await expect(
      db.query(recordRunSql, runArguments({ 2: taskTwoId, 3: reviewerAgentId })),
    ).rejects.toThrow(/task not found/i);

    await assumeRole(db, "authenticated", ownerTwoId);
    await expect(
      db.query(recordRunSql, runArguments({ 3: reviewerAgentId })),
    ).rejects.toThrow(/owner or administrator/i);
  });

  it("keeps catalogue reads tenant-scoped and raw routing evidence behind bounded RPCs", async () => {
    await assumeRole(db, "authenticated", memberOneId);
    const visible = await db.query<{ count: string }>(
      "select count(*)::text as count from public.provider_model_configurations",
    );
    expect(Number(visible.rows[0]?.count)).toBeGreaterThan(0);
    await expect(db.query("select * from public.provider_routing_decisions")).rejects.toThrow();
    await expect(db.query("select * from public.provider_run_events")).rejects.toThrow();

    await assumeRole(db, "authenticated", ownerTwoId);
    const foreign = await db.query<{ count: string }>(
      "select count(*)::text as count from public.provider_model_configurations",
    );
    expect(foreign.rows[0]?.count).toBe("0");

    await assumeRole(db, "anon", null);
    await expect(db.query("select * from public.provider_model_configurations")).rejects.toThrow();
    await expect(db.query("select * from public.provider_routing_decisions")).rejects.toThrow();
    await expect(db.query("select * from public.provider_run_events")).rejects.toThrow();
  });

  it("blocks direct writes to every provider table for authenticated callers", async () => {
    await assumeRole(db, "authenticated", ownerOneId);

    await expect(
      db.query(
        `insert into public.provider_model_configurations
           (organization_id, provider, model, display_name, created_by)
         values ($1, 'anthropic', 'direct-write', 'Direct Write', $2)`,
        [organizationOneId, ownerOneId],
      ),
    ).rejects.toThrow();

    await expect(
      db.query("update public.provider_routing_decisions set decision = 'ROUTED'"),
    ).rejects.toThrow();

    await expect(db.query("delete from public.provider_run_events")).rejects.toThrow();
  });
});
