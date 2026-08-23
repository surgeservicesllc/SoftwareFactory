// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The two security invariants `AGENTS.md` states, checked across the whole
 * migration chain rather than a subset of it.
 *
 * > Keep Row Level Security enabled for every exposed Supabase table.
 *
 * Several suites assert this for the tables they touch, and the whole-chain
 * position was verified once by hand on a real PostgreSQL cluster. Neither is a
 * standing guarantee: a new migration adding a table without RLS passes every
 * existing test, because no existing test knows the table exists. The gap is
 * widest exactly when it matters most — a table added in the same change that
 * exposes it.
 *
 * So this applies every migration and asks the catalogue, which means a new
 * table is covered the moment it exists, without anyone remembering to add it
 * to a list.
 *
 * The second invariant is the `service_role` ACL matrix. That role bypasses
 * RLS, so a table privilege granted to it is an unmediated path to the data.
 * The reviewed position is that it holds table privileges on exactly the four
 * GitHub ingress tables and reaches everything else through SECURITY DEFINER
 * functions. Widening that is a RED change under `RISK_CLASSIFICATION.md`, and
 * this makes the widening visible in the diff that causes it.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

/** The only tables `service_role` may hold direct table privileges on. */
const GITHUB_INGRESS_TABLES = [
  "github_change_requests",
  "github_installations",
  "github_repositories",
  "github_webhook_deliveries",
] as const;

/**
 * Tables that deliberately carry RLS with no policy, and why.
 *
 * RLS plus zero policies denies everything, which is the strongest possible
 * position — correct when the only legitimate access is through a SECURITY
 * DEFINER function. It is listed rather than tolerated so that a *new*
 * policyless table still fails: the difference between "locked on purpose" and
 * "protected and never wired up" is intent, and intent has to be written down.
 */
const INTENTIONALLY_POLICYLESS: Readonly<Record<string, string>> = Object.freeze({
  ai_account_usage_observations:
    "Append-only usage evidence per AI account. Reads go through the "
    + "list_ai_account_usage member projection and the only writer is the "
    + "worker's record_ai_account_usage definer function; a policy would open "
    + "a second, silent path around both.",
  ai_accounts:
    "AI-account identities. No secret column, but every read goes through the "
    + "list_ai_accounts projection and every mutation through a definer function "
    + "that writes an activity event; a policy would open a second, silent path.",
  ai_auth_sessions:
    "Broker sign-in sessions. The sealed relay code must be impossible to read "
    + "rather than merely restricted — only the worker's definer function returns "
    + "it, and the browser's projection cannot name the column.",
  factory_command_routes:
    "Immutable command-to-pipeline-and-bot routing evidence. Authenticated callers "
    + "use bounded candidate and submit definer functions; every direct table path "
    + "is denied so no caller can bypass atomic validation or rewrite history.",
  factory_record_only_submission_guards:
    "Ephemeral one-use capabilities for the nested factory command transaction. "
    + "Every table privilege is denied; only the SECURITY DEFINER factory/public "
    + "command pair may create and consume a row, and successful calls leave none.",
  newsletter_subscribers:
    "Public-input table. Inserts happen only through public.subscribe_to_newsletter; "
    + "anon and authenticated hold no SELECT, INSERT, UPDATE, or DELETE privilege.",
  provider_credentials:
    "Holds sealed credential envelopes. A policy would imply some role may read the "
    + "column; none may. Every table privilege is revoked from anon, authenticated and "
    + "service_role, and the only readers are definer functions.",
  project_agents:
    "Which logical agents a project's AI Factory includes. Reads go through the "
    + "list_project_agents member projection and writes through the "
    + "owner/administrator select_project_agent and deselect_project_agent "
    + "definer functions, both of which write an activity event; a policy would "
    + "open a second, unaudited path to the same rows.",
  project_pipelines:
    "Which pipeline templates a project runs. Reads go through the "
    + "list_project_pipelines member projection and writes through the "
    + "owner/administrator select_project_pipeline and deselect_project_pipeline "
    + "definer functions, both of which write an activity event; a policy would "
    + "open a second, unaudited path to the same rows.",
  provider_connect_sessions:
    "Holds sign-in code digests. Same reasoning: reading this table must be impossible "
    + "rather than merely restricted, so there is no role for a policy to describe.",
});

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);

  const files = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }
}, 600_000);

afterAll(async () => {
  await db?.close();
});

describe("row level security", () => {
  it("is enabled and forced on every public table", async () => {
    const result = await db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      select class.relname, class.relrowsecurity, class.relforcerowsecurity
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public' and class.relkind = 'r'
      order by class.relname
    `);

    // Named, not counted: a count tells you something broke, a list tells you what.
    const unprotected = result.rows
      .filter((row) => !row.relrowsecurity || !row.relforcerowsecurity)
      .map((row) => row.relname);

    expect(unprotected).toEqual([]);
    // Guards against a vacuous pass if the chain ever fails to apply.
    expect(result.rows.length).toBeGreaterThan(50);
  });

  it("carries a policy on every table except the ones locked shut on purpose", async () => {
    const result = await db.query<{ relname: string; policy_count: number }>(`
      select class.relname, count(policy.oid)::integer as policy_count
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      left join pg_catalog.pg_policy policy on policy.polrelid = class.oid
      where namespace.nspname = 'public' and class.relkind = 'r'
      group by class.relname
      order by class.relname
    `);

    const policyless = result.rows.filter((row) => row.policy_count === 0).map((row) => row.relname);

    // Equality, not a subset check: a table that gains a policy should drop off
    // the allowlist, and a new policyless table should fail until someone says
    // why it is locked.
    expect(policyless).toEqual(Object.keys(INTENTIONALLY_POLICYLESS).sort());
  });
});

describe("the service_role ACL matrix", () => {
  it("holds table privileges on exactly the four GitHub ingress tables", async () => {
    const result = await db.query<{ table_name: string }>(`
      select distinct table_name
      from information_schema.role_table_grants
      where grantee = 'service_role' and table_schema = 'public'
      order by table_name
    `);

    const granted = result.rows.map((row) => row.table_name);

    // service_role bypasses RLS, so each entry here is an unmediated path to
    // the data. Widening this set is RED under RISK_CLASSIFICATION.md.
    expect(granted).toEqual([...GITHUB_INGRESS_TABLES].sort());
  });

  it("reaches everything else through SECURITY DEFINER functions instead", async () => {
    const result = await db.query<{ count: number }>(`
      select count(*)::integer as count
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public' and proc.prosecdef
    `);

    expect(result.rows[0].count).toBeGreaterThan(0);
  });
});

describe("SECURITY DEFINER functions", () => {
  it("all pin a search_path", async () => {
    // A SECURITY DEFINER function runs with its owner's privileges. Without a
    // pinned search_path, a caller who can create objects in a schema earlier
    // on that path can shadow a table or operator the body resolves
    // unqualified, and the function will execute their version as the owner.
    // That is privilege escalation, and it is invisible in the function body.
    const result = await db.query<{ proname: string; args: string; proconfig: string[] | null }>(`
      select proc.proname, pg_get_function_identity_arguments(proc.oid) as args, proc.proconfig
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public' and proc.prosecdef
      order by proc.proname
    `);

    const unpinned = result.rows
      .filter((row) => !(row.proconfig ?? []).some((c) => c.toLowerCase().startsWith("search_path=")))
      .map((row) => `${row.proname}(${row.args})`);

    expect(unpinned).toEqual([]);
    expect(result.rows.length).toBeGreaterThan(100);
  });

  it("lets anonymous callers execute exactly one of them", async () => {
    // The entire anonymous attack surface against privileged code. A new grant
    // here is a new way for an unauthenticated request to run as the owner, so
    // it should be a deliberate, reviewed change rather than a side effect.
    const result = await db.query<{ proname: string }>(`
      select proc.proname
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public' and proc.prosecdef
        and has_function_privilege('anon', proc.oid, 'EXECUTE')
      order by proc.proname
    `);

    expect(result.rows.map((row) => row.proname)).toEqual(["subscribe_to_newsletter"]);
  });

  it("limits service_role to the reviewed trusted-server and worker RPCs", async () => {
    const result = await db.query<{ proname: string }>(`
      select distinct proc.proname
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public' and proc.prosecdef
        and has_function_privilege('service_role', proc.oid, 'EXECUTE')
      order by proc.proname
    `);

    // service_role bypasses RLS, so each of these is privileged code reachable
    // by the worker's key. Pinned by name: the set should change only when a
    // phase deliberately gives the worker a new capability.
    expect(result.rows.map((row) => row.proname)).toEqual([
      "agentos_record_trigger_delivery",
      "append_phase1c_run_event",
      // The auth-broker worker's eight capabilities: drive a sign-in session
      // through the provider's real login. `read_ai_auth_relay_code` returns
      // a sealed envelope useless without SOFTWAREFACTORY_CREDENTIAL_KEY, and
      // `complete_` accepts only an already-sealed credential — plaintext
      // never crosses this boundary in either direction.
      "claim_ai_auth_session",
      "claim_phase1c_run",
      // The graph executor's four capabilities, mirroring the Phase 1C
      // pattern: claim an unrun graph atomically (run + node_runs + the whole
      // projection in one call), transition nodes under the same
      // terminal-states-are-final rule the member path enforces, append
      // artifacts, and close the run — where incomplete input can never be
      // recorded as COMPLETED. No credential material crosses any of them.
      "claim_planned_graph",
      // The provider sign-in path, added with the credential vault. `claim_`
      // and `resolve_` are reachable only by presenting a valid one-time code,
      // and `read_` returns ciphertext that is useless without
      // SOFTWAREFACTORY_CREDENTIAL_KEY, which is deliberately not in the
      // database. The server has no other privileged identity to call them with.
      "claim_provider_connect_session",
      "complete_ai_auth_session",
      "complete_github_change_request",
      "complete_graph_run_as_worker",
      "complete_phase1c_run",
      "disconnect_github_connection",
      "expire_ai_auth_sessions",
      "fail_ai_auth_session",
      "fail_github_change_request",
      "fail_github_change_request_with_evidence",
      "finish_phase1c_worker",
      "heartbeat_phase1c_run",
      "heartbeat_phase1c_worker",
      // Read-only session-state projection for the worker's log — status and
      // timing, never the sealed relay code.
      "inspect_ai_auth_sessions",
      "jsonb_has_sensitive_keys",
      // The verification sweep's two hands: enumerate connected subscription
      // accounts, and record a shape-level pass. Demotion is the function
      // below; a pass is a timestamp, not an event.
      "list_ai_accounts_for_verification",
      // Purpose names only — the unbounded-accounts overlay has to discover
      // which slots exist before reading them; ciphertext still comes one
      // purpose at a time through read_provider_credential.
      "list_provider_credential_purposes",
      "mark_ai_account_needs_reauth",
      "mark_ai_account_verified",
      "mark_ai_auth_session_verifying",
      "mark_github_connection_lost",
      // The lifecycle's one worker write: open the gate a finished stage waits
      // at. Keyed to the graph node, so an approval outlives the run that
      // asked for it, and idempotent on that key — a re-claim finds the
      // existing decision rather than manufacturing a second, undecided gate.
      "open_node_gate_as_worker",
      "process_github_webhook_delivery",
      "read_ai_auth_relay_code",
      // Status only, never the sealed code: a worker mid-drive can notice a
      // cancel and stop instead of blind-waiting out the relay window.
      "read_ai_auth_session_status",
      "read_provider_credential",
      "reconcile_github_repository_grants",
      // The usage sweep's one write: append a provider-usage observation for
      // an account the worker just probed. Insert-only into an append-only
      // table; the definer function revalidates the account/organization pair.
      "record_ai_account_usage",
      // Server-only credential evaluation records a verdict only when the
      // exact bot identity/configuration/revision still matches under row lock.
      // Browser-authenticated managers cannot execute this RPC directly.
      "record_bot_readiness_preserving_disabled",
      "record_graph_artifact_as_worker",
      /*
       * The stage handoff: what one stage passed the next, and whether the
       * payload satisfied the receiving node's contract at the moment it was
       * handed over.
       *
       * Worker-only for the same reason every other write here is. A handoff
       * is a provenance record — it says the architecture package BUILD
       * received was the one ARCHITECT sent — and a provenance record anything
       * holding the service key could fabricate through a table grant would be
       * worth nothing. The function proves the worker's identity, resolves the
       * organization from the run rather than trusting a parameter, and
       * refuses a receiving node in another tenant.
       */
      "record_graph_handoff_as_worker",
      "record_node_state_as_worker",
      "record_phase1c_run_artifact",
      "record_phase1c_validation",
      // The reviewing half of the executor: a node whose job is judging other
      // nodes' work writes its verdict, lens, and evidence where a person can
      // audit it. Same self-verification refusal as the member function.
      "record_verification_as_worker",
      "recover_github_change_request_with_provider_evidence",
      "register_phase1c_worker",
      // Moves a never-started run's planned base to the observed live head.
      // Lease-guarded and refused once any commit exists, so pushed work can
      // never be orphaned by a re-plan.
      "replan_phase1c_run",
      "report_ai_auth_login_url",
      "resolve_provider_connect_session",
      // Which provider account signed in — display data on a completed
      // sign-in, shape-checked against secrets, reported only by the worker.
      "set_ai_account_provider_identity",
      // Stores a credential obtained through an OAuth callback. Server-only:
      // a browser must never write that table directly, or the seal would be
      // whatever the browser sent.
      "store_provider_credential",
      "sync_github_installation",
    ]);
  });
});

describe("anonymous access", () => {
  it("holds no write privilege on any public table", async () => {
    const result = await db.query<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'anon'
        and table_schema = 'public'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      order by table_name, privilege_type
    `);

    expect(result.rows).toEqual([]);
  });
});
