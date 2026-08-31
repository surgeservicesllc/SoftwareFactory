// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = ".github/workflows/grok-record-only-production-acceptance.yml";
const specPath = "tests/e2e/grok-record-only-production.spec.ts";
const preflightPath = ".github/grok-release/grok-record-only-acceptance-preflight.sql";
const postflightPath = ".github/grok-release/grok-record-only-acceptance-postflight.sql";
const source = readFileSync(resolve(root, workflowPath), "utf8");
const spec = readFileSync(resolve(root, specPath), "utf8");
const preflight = readFileSync(resolve(root, preflightPath), "utf8");
const postflight = readFileSync(resolve(root, postflightPath), "utf8");

type WorkflowStep = Readonly<{
  name: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
}>;

const workflow = parse(source) as {
  on: { workflow_dispatch: { inputs: Record<string, unknown> } };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: {
    acceptance: {
      "timeout-minutes": number;
      env: Record<string, string>;
      steps: WorkflowStep[];
    };
  };
};
const steps = workflow.jobs.acceptance.steps;

function step(name: string) {
  const found = steps.find((candidate) => candidate.name === name);
  expect(found).toBeDefined();
  return found!;
}

describe("Grok record-only production acceptance workflow", () => {
  it("is manual, least-privilege, and serialized with hosted migrations", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      "confirm",
      "release_sha",
      "project_id",
      "project_name",
      "repository",
      "default_branch",
    ]);
    expect(workflow.on.workflow_dispatch.inputs).not.toHaveProperty("email");
    expect(workflow.on.workflow_dispatch.inputs).not.toHaveProperty("password");
    expect(workflow.on.workflow_dispatch.inputs).not.toHaveProperty("base_url");
    expect(workflow.permissions).toEqual({
      actions: "read",
      checks: "read",
      contents: "read",
      deployments: "read",
    });
    expect(workflow.concurrency).toEqual({
      group: "apply-hosted-migrations",
      "cancel-in-progress": false,
    });
    expect(workflow.jobs.acceptance["timeout-minutes"]).toBe(25);
  });

  it("pins one production origin, project, account, actor, run attempt, and exact green SHA", () => {
    expect(workflow.jobs.acceptance.env).toMatchObject({
      PROJECT_REF: "qpuofpmagrmyamahqwxw",
      PRODUCTION_ORIGIN: "https://www.theagoras.com",
      PRODUCTION_HEALTH_URL: "https://www.theagoras.com/api/health",
      FAKE_JOURNEY_ACCOUNT: "jordan.seeker.prod1@example.org",
    });
    expect(step("Authorize one exact record-only acceptance").env?.AUTHORIZED_ACTOR).toBe(
      "${{ vars.PRODUCTION_RELEASE_ACTOR }}",
    );
    const authorize = step("Authorize one exact record-only acceptance").run ?? "";
    for (const proof of [
      '"record-grok-goal"',
      "AUTHORIZED_ACTOR",
      "GITHUB_ACTOR",
      "GITHUB_TRIGGERING_ACTOR",
      "GITHUB_RUN_ATTEMPT",
      '"1"',
      '"surgeservicesllc/SoftwareFactory"',
      '"refs/heads/main"',
      "singleLine",
      "^[0-9a-f]{40}$",
    ]) expect(authorize).toContain(proof);

    const release = step("Verify exact green production and stopped execution workflows").run ?? "";
    for (const proof of [
      "CURRENT_MAIN_SHA",
      "GITHUB_SHA",
      "Lint, typecheck, test, and build",
      "Browser and accessibility tests 1/3",
      "Browser and accessibility tests 2/3",
      "Browser and accessibility tests 3/3",
      '.environment=="Production"',
      '.creator.login=="vercel[bot]"',
      '.releaseSha==$sha',
      '.databaseProjectRef==$project',
    ]) expect(release).toContain(proof);
  });

  it("takes credentials only from secrets and disables browser capture", () => {
    const browser = step("Record and reload one harmless Grok goal");
    expect(browser.env?.GROK_RECORD_ONLY_E2E_PASSWORD).toBe(
      "${{ secrets.GROK_RECORD_ONLY_E2E_PASSWORD }}",
    );
    expect(browser.env?.PLAYWRIGHT_BASE_URL).toBe("https://www.theagoras.com");
    expect(browser.run).toContain(
      "playwright test tests/e2e/grok-record-only-production.spec.ts",
    );
    expect(spec).toContain('trace: "off"');
    expect(spec).toContain('screenshot: "off"');
    expect(spec).toContain('video: "off"');
    expect(source).not.toMatch(/sk-proj-[A-Za-z0-9_-]{20,}/i);
    expect(spec).not.toMatch(/sk-proj-[A-Za-z0-9_-]{20,}/i);
  });

  it("allows exactly one Grok create mutation and no control or worker call", () => {
    expect(spec).toContain('url.pathname === "/api/grok/sessions"');
    expect(spec).toContain("expect(createPosts).toBe(1)");
    expect(spec).toContain("expect(unexpectedMutations).toEqual([])");
    expect(spec).not.toContain("/control");
    expect(spec).not.toMatch(/getByRole\([^\n]+resume[^\n]+\.click/i);
    expect(source).not.toMatch(/\bgh\s+workflow\s+run\b|\/dispatches\b/i);
    expect(source).not.toMatch(
      /^\s*(?:PHASE1C_WORKER_ENABLED|GRAPH_WORKER_ENABLED|GRAPH_WORKER_SCHEDULED):\s*(?:true|"true")\s*$/im,
    );
    expect(source).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
  });

  it("keeps both database verifiers read-only and proves immutable zero-execution evidence", () => {
    const persistentMutation = /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke|notify)\b/im;
    expect(preflight).not.toMatch(persistentMutation);
    expect(postflight).not.toMatch(persistentMutation);
    for (const proof of [
      "planner,version",
      "admissionRoster",
      "grok_specialist_admission_hash",
      "assert_current_grok_execution_admissions",
      "grok_current_execution_admission_hash",
      "roster.admitted",
      "graph.planned",
      "workerWoken",
      "executionStarted",
      "public.graph_runs",
      "public.node_runs",
      "public.agent_runs",
      "public.provider_run_events",
      "public.graph_phase1c_bridges",
      "public.grok_phase1c_submission_guards",
    ]) expect(postflight).toContain(proof);
  });

  it("keeps workers, autonomy, automatic actions, and the kill switch stopped before and after", () => {
    const release = step("Verify exact green production and stopped execution workflows").run ?? "";
    const final = step("Reverify exact main health and stopped execution workflows").run ?? "";
    for (const workflowName of [
      "graph-worker.yml",
      "codex-worker.yml",
      "claude-worker.yml",
      "auth-broker.yml",
      "graph-live-canary.yml",
      "handoff-canary.yml",
      "graph-artifact-containment.yml",
    ]) {
      expect(release).toContain(workflowName);
      expect(final).toContain(workflowName);
    }
    for (const proof of [
      "autonomy_kill_switch_active is distinct from true",
      "auto_plan",
      "auto_code",
      "auto_test",
      "auto_repair",
      "auto_review",
      "auto_approve",
      "auto_merge",
      "auto_deploy",
      "auto_rollback",
      "current_run_id is not null",
      "state = 'RUNNING'",
      "status = 'running'",
    ]) {
      expect(preflight).toContain(proof);
      expect(postflight).toContain(proof);
    }
  });
});
