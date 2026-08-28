// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(
  import.meta.dirname,
  "../../.github/workflows/accept-factory-production-url.yml",
);
const source = readFileSync(workflowPath, "utf8");

type Step = {
  readonly env?: Readonly<Record<string, string>>;
  readonly name: string;
  readonly run?: string;
};
type Workflow = {
  readonly on: {
    readonly workflow_dispatch: {
      readonly inputs: Readonly<Record<string, unknown>>;
    };
  };
  readonly permissions: Readonly<Record<string, string>>;
  readonly jobs: {
    readonly acceptance: {
      readonly env: Readonly<Record<string, string>>;
      readonly if?: string;
      readonly steps: readonly Step[];
    };
  };
};

const workflow = parse(source) as Workflow;
const job = workflow.jobs.acceptance;
const commands = job.steps.map((step) => step.run ?? "").join("\n");

describe("the one-shot Factory production URL acceptance", () => {
  it("is manual, exact-release, exact-actor, first-attempt, and serialized with migrations", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      "release_sha",
      "confirm",
    ]);
    expect(job.if).toBeUndefined();
    const gate = job.steps[0];
    expect(gate.name).toBe("Verify the immutable invocation identity");
    expect(gate.env).toEqual({
      AUTHORIZED_ACTOR: "${{ vars.PRODUCTION_RELEASE_ACTOR }}",
      CONFIRM: "${{ inputs.confirm }}",
      RELEASE_SHA: "${{ inputs.release_sha }}",
    });
    for (const marker of [
      'CONFIRM" != "ACCEPT FACTORY PRODUCTION URL',
      'GITHUB_REF" != "refs/heads/main',
      'GITHUB_ACTOR" != "$AUTHORIZED_ACTOR',
      'GITHUB_TRIGGERING_ACTOR" != "$AUTHORIZED_ACTOR',
      'GITHUB_RUN_ATTEMPT" != "1',
    ])
      expect(gate.run).toContain(marker);
    expect(gate.run).toContain("exit 1");
    expect(source).toContain("group: apply-hosted-migrations");
    expect(commands).toContain('GITHUB_SHA" != "$RELEASE_SHA');
    expect(commands).toContain("CURRENT_MAIN_SHA");
    expect(workflow.permissions).toEqual({
      actions: "read",
      checks: "read",
      contents: "read",
      deployments: "read",
    });
  });

  it("binds exact production identity, green checks, READY deploy, health, and stopped workflows", () => {
    expect(job.env).toEqual({
      PROJECT_REF: "qpuofpmagrmyamahqwxw",
      SITE_ORIGIN: "https://www.theagoras.com",
      TARGET_URL: "https://www.theagoras.com",
      VERCEL_PROJECT_ID: "prj_pAsrhftaVWI4SyaqstgRVSWHJkdD",
    });
    for (const marker of [
      "Lint, typecheck, test, and build",
      "Browser and accessibility tests 1/3",
      "Browser and accessibility tests 2/3",
      "Browser and accessibility tests 3/3",
      "Vercel Production is not READY",
      "releaseSha==$sha",
      "graph-worker.yml",
      "claude-worker.yml",
      "auth-broker.yml",
      "SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED",
      "SOFTWAREFACTORY_GRAPH_WORKER_ENABLED",
      "SOFTWAREFACTORY_AUTH_BROKER_DISABLED",
    ])
      expect(source).toContain(marker);
  });

  it("keeps personal targets and service authority in protected secrets and masks them", () => {
    const acceptance = job.steps.find((step) =>
      step.name.startsWith("Exercise the signed-in"),
    );
    expect(acceptance?.env).toEqual({
      AUTH_BROKER_DISABLED: "${{ vars.SOFTWAREFACTORY_AUTH_BROKER_DISABLED }}",
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      GRAPH_WORKER_ENABLED: "${{ vars.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED }}",
      GRAPH_WORKER_SCHEDULED:
        "${{ vars.SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED }}",
      OWNER_EMAIL: "${{ secrets.PRODUCTION_ACCEPTANCE_OWNER_EMAIL }}",
      PHASE1C_WORKER_ENABLED:
        "${{ vars.SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED }}",
      PROJECT_NAME: "${{ secrets.PRODUCTION_ACCEPTANCE_PROJECT_NAME }}",
      RELEASE_SHA: "${{ inputs.release_sha }}",
      SERVICE_ROLE_KEY:
        "${{ secrets.SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY }}",
    });
    expect(source).not.toContain("daniel.hughen@gmail.com");
    expect(source).not.toContain("SoftwareFactory_08.21.2026");
    expect(commands).toContain('echo "::add-mask::$OWNER_EMAIL"');
    expect(commands).toContain('echo "::add-mask::$PROJECT_NAME"');
    expect(commands).toContain('echo "::add-mask::$SERVICE_ROLE_KEY"');
    expect(commands).toContain('echo "::add-mask::$HASHED_TOKEN"');
    expect(commands).not.toMatch(/set\s+-x/);
  });

  it("requires the exact ledger and fully stopped database before signing in", () => {
    expect(commands).toContain('[ "$ledger" = "1|1|1|1|0|0" ]');
    for (const marker of [
      "autonomy_kill_switch_active is distinct from true",
      "coalesce(auto_plan,false)",
      "coalesce(auto_rollback,false)",
      "phase1c_workers",
      "current_run_id is not null",
      "graph_runs where state='RUNNING'",
      "agent_runs where status='running'",
    ])
      expect(commands).toContain(marker);
    expect(
      commands.match(/^verify_live_release_and_workflows$/gm),
    ).toHaveLength(3);
    expect(
      commands.match(/^verify_database_containment_and_catalog$/gm),
    ).toHaveLength(3);
    expect(
      commands.match(/commits\/\$\{RELEASE_SHA\}\/check-runs/g),
    ).toHaveLength(1);
  });

  it("uses one ephemeral owner magic link without reading or changing a password", () => {
    expect(commands).toContain("/auth/v1/admin/generate_link");
    expect(commands).toContain(
      '{type:"magiclink",email:$email,redirect_to:$redirect}',
    );
    expect(commands).toContain(".hashed_token // empty");
    expect(commands).toContain("/auth/callback?token_hash=");
    expect(commands).toContain("--cookie-jar");
    expect(commands).toContain("trap cleanup EXIT");
    expect(commands).toContain("auth_user.email_confirmed_at is not null");
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).not.toContain(
      "password",
    );
    expect(source).not.toContain("PRODUCTION_ACCEPTANCE_OWNER_PASSWORD");
    expect(commands).not.toMatch(/OWNER_PASSWORD|password:\s*\$\{\{/i);
  });

  it("proves the authenticated owner/admin write, one audit, no-op replay, and reload", () => {
    for (const marker of [
      "membership.role::text in ('owner','admin')",
      "one-shot acceptance requires an unset production URL",
      'post_json "/api/organizations/active"',
      "/api/projects/${PROJECT_ID}/production-url",
      "AFTER_FIRST_COUNT",
      "BEFORE_COUNT + 1",
      'AUDIT" = "${OWNER_USER_ID}|1',
      "AFTER_REPLAY_COUNT",
      "/api/portfolio",
      ".productionUrl==$url",
      "activity_events_append_only",
      "8ce3a8b74159b3dd16c710a1e07b5191",
      "project_production_url_is_safe('https://user@example.com')",
      "project_production_url_is_safe('https://127.0.0.1')",
      "project_production_url_is_safe('https://www.theagoras.com/?secret=x')",
      "activity events are append-only",
      "tgfoid='public.reject_activity_event_mutation()'::regprocedure",
      "tgtype=27",
      "tgconstraint=0",
      "tgparentid=0",
      "not has_table_privilege('service_role',relation.oid,'UPDATE,DELETE,TRUNCATE')",
    ])
      expect(commands).toContain(marker);
  });

  it("resolves protected selectors through psql stdin so variable quoting is honored", () => {
    expect(commands).toMatch(
      /ROWS=\$\(psql "\$DB_URL" -v ON_ERROR_STOP=1 -X -AtF '\|' \\\n\s+-v owner_email="\$OWNER_EMAIL" -v project_name="\$PROJECT_NAME" <<'SQL'\nselect auth_user\.id/,
    );
    expect(commands).toContain(
      "where lower(auth_user.email)=lower(:'owner_email')",
    );
    expect(commands).toContain("and project.name=:'project_name'");
    expect(commands).toMatch(/project\.status::text<>'archived';\nSQL\n\)/);
    expect(commands).not.toMatch(
      /-v owner_email="\$OWNER_EMAIL" -v project_name="\$PROJECT_NAME" -c\s/,
    );
  });
});
