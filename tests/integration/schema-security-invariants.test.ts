// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

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


/**
 * The only tables `service_role` may hold direct table privileges on: the
 * ingress tables of the two signature-verified webhooks. GitHub's deliveries
 * have held this position since Phase 1; the Stripe billing mirror
 * (20260825000400, ADR-149) is the second and equal case — an external
 * system's verified events, written by a route that has no user session to
 * write as. Its audit trail goes through record_billing_activity, a definer
 * function, so activity_events stays out of this list. Everything else is
 * reached through SECURITY DEFINER functions, and widening this list further
 * stays RED.
 */
const VERIFIED_WEBHOOK_INGRESS_TABLES = [
  "billing_customers",
  "billing_events",
  "billing_subscriptions",
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
  graph_artifact_payload_containments:
    "Private immutable digest and classification evidence for forward-only legacy "
    + "artifact containment. FORCE RLS is required and every non-owner table ACL is "
    + "closed, including anon, authenticated, and service_role; the postgres-owned "
    + "migration path is the only writer, so a policy would create an unintended "
    + "second access path to the audit rows.",
  graph_release_gate_approval_intents:
    "Append-only, one-use owner intent evidence for TEST and DEPLOYMENT gates. "
    + "Browsers request an intent and the server consumes it only through bounded "
    + "SECURITY DEFINER RPCs; direct reads or writes would bypass the nonce, exact "
    + "provider evidence, and immutable approval audit.",
  grok_phase1c_submission_guards:
    "Ephemeral one-use capabilities binding a current Grok admission to the "
    + "nested Phase 1C command transaction. Every table privilege is denied; "
    + "only the exact SECURITY DEFINER submission path may create and consume "
    + "a row, and successful calls leave none.",
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
  // The chain, restored from a snapshot rather than replayed; the
  // helper keys its cache on the CONTENT of every migration, and
  // asserts coverage of the whole directory.
  db = await createMigratedDatabase();
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
  it("holds table privileges on exactly the verified-webhook ingress tables", async () => {
    const result = await db.query<{ table_name: string }>(`
      select distinct table_name
      from information_schema.role_table_grants
      where grantee = 'service_role' and table_schema = 'public'
      order by table_name
    `);

    const granted = result.rows.map((row) => row.table_name);

    // service_role bypasses RLS, so each entry here is an unmediated path to
    // the data. Widening this set is RED under RISK_CLASSIFICATION.md.
    expect(granted).toEqual([...VERIFIED_WEBHOOK_INGRESS_TABLES].sort());
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
      "abort_graph_run_as_worker",
      "acknowledge_grok_graph_wake_as_worker",
      "agentos_record_trigger_delivery",
      "append_grok_message_as_server",
      "append_phase1c_run_event",
      // Full Lifecycle v2 release gates are evidence-bound. These wrappers
      // atomically validate and persist the exact merge/deployment evidence
      // with the gate decision instead of exposing low-level record helpers.
      "approve_graph_phase1c_deployment_gate_as_worker",
      "approve_graph_phase1c_test_gate_as_worker",
      // Absence-only guard for initial claims. It returns no wake identity;
      // any Resume history requires the exact opaque dispatch payload.
      "assert_no_grok_graph_wake_payload_required_as_worker",
      "bind_graph_phase1c_run_by_command_as_worker",
      // The auth-broker worker's eight capabilities: drive a sign-in session
      // through the provider's real login. `read_ai_auth_relay_code` returns
      // a sealed envelope useless without SOFTWAREFACTORY_CREDENTIAL_KEY, and
      // `complete_` accepts only an already-sealed credential — plaintext
      // never crosses this boundary in either direction.
      "claim_ai_auth_session",
      "claim_grok_graph_rewake_as_worker",
      // A dispatch-bound Phase 1C wake may commit only the exact command UUID
      // supplied by the trusted server. Protocol v3 is the only executable
      // claim surface; the v2 routines remain present but private so every
      // claim passes through the immutable admission fence.
      "claim_phase1c_run_by_command_v3",
      "claim_phase1c_run_v3",
      // The graph executor's four capabilities, mirroring the Phase 1C
      // pattern: claim an unrun graph atomically (run + node_runs + the whole
      // projection in one call), transition nodes under the same
      // terminal-states-are-final rule the member path enforces, append
      // artifacts, and close the run — where incomplete input can never be
      // recorded as COMPLETED. No credential material crosses any of them.
      "claim_planned_graph_by_id_v3",
      "claim_planned_graph_v3",
      // The provider sign-in path, added with the credential vault. `claim_`
      // and `resolve_` are reachable only by presenting a valid one-time code,
      // and `read_` returns ciphertext that is useless without
      // SOFTWAREFACTORY_CREDENTIAL_KEY, which is deliberately not in the
      // database. The server has no other privileged identity to call them with.
      "claim_provider_connect_session",
      "complete_ai_auth_session",
      "complete_github_change_request",
      // Release-lineage writes are exposed only through atomic worker
      // wrappers. The legacy completion functions remain implementation
      // details, so a terminal run can never strand its graph bridge.
      "complete_graph_run_with_phase1c_bridge_as_worker",
      "complete_graph_run_with_validated_release_as_worker",
      "complete_phase1c_run_with_graph_bridge_as_worker",
      "complete_reviewer_with_verifications_as_worker",
      "create_graph_from_plan_with_release_identity_as_server",
      // The anchored-automatic-gate decider (20260824000100): approves only
      // AUTOMATIC gates holding anchors, after the run closes; refuses human
      // gates unconditionally. ADR-140.
      "decide_automatic_gate_as_worker",
      // Bounded queue diagnosis replaces broad direct table reads and exposes
      // only graph ids, execution states, timestamps, and executor names.
      "diagnose_graph_queue_as_worker_v2",
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
      // Grok has no service_role table grants. Its bounded server/worker RPCs
      // and null-fenced canonical Full Lifecycle v4 launcher are pinned by exact overload
      // below; the launcher atomically pauses before visibility.
      // Deploy intent receives only a resource-free GREEN readiness projection;
      // its RED delivery handoff remains immutable plan evidence, never a node.
      "launch_grok_deploy_readiness_v1_as_server",
      "launch_grok_full_lifecycle_v4_as_server",
      // Research launches the planner's exact Claude-only, zero-write DAG;
      // this service boundary also pauses before visibility and never wakes.
      "launch_grok_read_only_research_v2_as_server",
      "link_grok_artifact_as_server",
      "link_grok_task_as_server",
      // The verification sweep's two hands: enumerate connected subscription
      // accounts, and record a shape-level pass. Demotion is the function
      // below; a pass is a timestamp, not an event.
      "list_ai_accounts_for_verification",
      // Purpose names only — the unbounded-accounts overlay has to discover
      // which slots exist before reading them; ciphertext still comes one
      // purpose at a time through read_provider_credential.
      // The alert engine's boundary pair (20260829000300, ADR-164): the
      // scheduled runner lists due alerts (with exactly the evaluator's
      // profile facts and the delivered-URL set) and — see its sibling
      // record_job_seeker_alert_scan below — records each scan's deliveries
      // against the never-repeat UNIQUE constraint. service_role executes
      // these two and holds no job-seeker table grant.
      "list_due_job_seeker_alerts",
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
      // The engine's wave-boundary pause poll (20260830000400): boolean
      // only — whether a person asked this run's graph to hold. The member
      // control that SETS the pause is authenticated-only; the worker can
      // read the flag and nothing else about the graph.
      "read_graph_pause_as_worker",
      // Opens only the exact hash-bound credential named by the immutable
      // execution admission; no provider/account fallback is possible.
      "read_grok_execution_credential_as_worker",
      // The lifecycle resume read (20260824000200): the most recently
      // completed recorded result per node from a lifecycle graph's own
      // earlier non-answering runs. Read-only; scoped to lifecycles in SQL.
      "read_prior_node_results_as_worker_v2",
      "read_provider_credential",
      "reconcile_github_repository_grants",
      // The usage sweep's one write: append a provider-usage observation for
      // an account the worker just probed. Insert-only into an append-only
      // table; the definer function revalidates the account/organization pair.
      "record_ai_account_usage",
      // The Stripe webhook's audit write: one activity event per subscription
      // transition, validated and clamped inside the definer, so
      // activity_events itself keeps zero service_role table privileges
      // (20260825000400, ADR-149).
      "record_billing_activity",
      // Server-only credential evaluation records a verdict only when the
      // exact bot identity/configuration/revision still matches under row lock.
      // Browser-authenticated managers cannot execute this RPC directly.
      "record_bot_readiness_preserving_disabled",
      "record_graph_artifact_as_worker",
      // Initial Grok context is written only after the server has derived and
      // normalized its project/repository identity. The definer revalidates
      // tenant ownership, exact message identity, bounds, hashes, and CAS.
      "record_grok_context_envelope_as_server",
      "record_grok_event_as_server",
      "record_grok_graph_rewake_delivery_as_worker",
      // Transport acceptance/failure is append-only and is deliberately
      // separate from the exact worker acknowledgement above.
      "record_grok_graph_wake_dispatch_as_server",
      "record_grok_planning_failure_as_server",
      "record_grok_specialist_roster_v2_as_server",
      "record_job_seeker_alert_scan",
      "record_node_state_as_worker",
      "record_phase1c_run_artifact",
      "record_phase1c_validation",
      "recover_github_change_request_with_provider_evidence",
      "register_phase1c_worker",
      // Moves a never-started run's planned base to the observed live head.
      // Lease-guarded and refused once any commit exists, so pushed work can
      // never be orphaned by a re-plan.
      "replan_phase1c_run",
      "report_ai_auth_login_url",
      "resolve_grok_control_intent_as_server",
      "resolve_provider_connect_session",
      // Which provider account signed in — display data on a completed
      // sign-in, shape-checked against secrets, reported only by the worker.
      "set_ai_account_provider_identity",
      "set_grok_session_status_as_server",
      // Stores a credential obtained through an OAuth callback. Server-only:
      // a browser must never write that table directly, or the seal would be
      // whatever the browser sent.
      "store_provider_credential",
      "sync_github_installation",
    ]);

    const grokFunctions = await db.query<{
      identity_arguments: string;
      proname: string;
    }>(`
      select
        pg_catalog.pg_get_function_identity_arguments(proc.oid) as identity_arguments,
        proc.proname
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public'
        and proc.proname in (
          'append_grok_message_as_server',
          'launch_grok_deploy_readiness_v1_as_server',
          'launch_grok_full_lifecycle_v3_as_server',
          'launch_grok_full_lifecycle_v4_as_server',
          'launch_grok_read_only_research_v1_as_server',
          'launch_grok_read_only_research_v2_as_server',
          'link_grok_artifact_as_server',
          'link_grok_task_as_server',
          'read_grok_execution_credential_as_worker',
          'record_grok_event_as_server',
          'record_grok_planning_failure_as_server',
          'record_grok_specialist_roster_v1_as_server',
          'record_grok_specialist_roster_v2_as_server',
          'resolve_grok_control_intent_as_server',
          'set_grok_session_status_as_server'
        )
        and proc.prosecdef
        and has_function_privilege('service_role', proc.oid, 'EXECUTE')
      order by proc.proname, identity_arguments
    `);

    expect(grokFunctions.rows).toEqual([
      {
        identity_arguments:
          "p_organization_id uuid, p_session_id uuid, p_role text, p_content text, p_metadata jsonb, p_idempotency_key text, p_expected_sequence bigint, p_reply_to_message_id uuid",
        proname: "append_grok_message_as_server",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_requested_by uuid, p_project_id uuid, p_session_id uuid, p_message_id uuid, p_idempotency_key text, p_goal text, p_topology graph_topology, p_topology_reasons jsonb, p_risk_level risk_level, p_requires_owner_approval boolean, p_nodes jsonb, p_edges jsonb, p_budget jsonb, p_roster_idempotency_key text, p_admissions jsonb",
        proname: "launch_grok_deploy_readiness_v1_as_server",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_requested_by uuid, p_project_id uuid, p_session_id uuid, p_message_id uuid, p_idempotency_key text, p_goal text, p_topology graph_topology, p_topology_reasons jsonb, p_risk_level risk_level, p_requires_owner_approval boolean, p_nodes jsonb, p_edges jsonb, p_budget jsonb, p_github_repository_id uuid, p_base_branch text, p_base_sha text, p_required_check_names jsonb, p_roster_idempotency_key text, p_admissions jsonb",
        proname: "launch_grok_full_lifecycle_v4_as_server",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_requested_by uuid, p_project_id uuid, p_session_id uuid, p_message_id uuid, p_idempotency_key text, p_goal text, p_topology graph_topology, p_topology_reasons jsonb, p_risk_level risk_level, p_requires_owner_approval boolean, p_nodes jsonb, p_edges jsonb, p_budget jsonb, p_roster_idempotency_key text, p_admissions jsonb",
        proname: "launch_grok_read_only_research_v2_as_server",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_session_id uuid, p_message_id uuid, p_task_link_id uuid, p_graph_artifact_id uuid, p_phase1c_artifact_id uuid, p_purpose text",
        proname: "link_grok_artifact_as_server",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_session_id uuid, p_message_id uuid, p_command_id uuid, p_task_id uuid, p_graph_id uuid, p_graph_run_id uuid, p_relation text",
        proname: "link_grok_task_as_server",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_admission_id uuid, p_admission_sha256 text",
        proname: "read_grok_execution_credential_as_worker",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_session_id uuid, p_event_type text, p_correlation_id uuid, p_payload jsonb, p_expected_sequence bigint, p_message_id uuid, p_task_link_id uuid",
        proname: "record_grok_event_as_server",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_session_id uuid, p_user_message_id uuid, p_error_code text, p_idempotency_key text, p_expected_version bigint",
        proname: "record_grok_planning_failure_as_server",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_requested_by uuid, p_project_id uuid, p_session_id uuid, p_message_id uuid, p_idempotency_key text, p_expected_event_sequence bigint",
        proname: "record_grok_specialist_roster_v2_as_server",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_intent_id uuid, p_state text, p_failure_code text, p_failure_detail text",
        proname: "resolve_grok_control_intent_as_server",
      },
      {
        identity_arguments:
          "p_organization_id uuid, p_session_id uuid, p_status text, p_expected_version bigint",
        proname: "set_grok_session_status_as_server",
      },
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
