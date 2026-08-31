// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import {
  GROK_CAUSAL_FINISH_CONFIRM,
  GROK_CAUSAL_PRODUCTION_ORIGIN,
  GROK_CAUSAL_REQUIRED_CHECKS,
  GROK_CAUSAL_START_CONFIRM,
  GROK_CAUSAL_SUPABASE_PROJECT,
  grokCausalFinishEvidenceSchema,
  grokCausalStartEvidenceSchema,
} from "../support/grok-causal-production";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = ".github/workflows/grok-causal-production-acceptance.yml";
const specPath = "tests/e2e/grok-causal-production.spec.ts";
const cliPath = "tests/support/validate-grok-causal-evidence.mts";
const source = readFileSync(resolve(root, workflowPath), "utf8");
const spec = readFileSync(resolve(root, specPath), "utf8");
const cli = readFileSync(resolve(root, cliPath), "utf8");

type WorkflowStep = Readonly<{
  name: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
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

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const head = "a".repeat(40);
const release = "b".repeat(40);
const digest = "c".repeat(64);
const checks = GROK_CAUSAL_REQUIRED_CHECKS.map((name, index) => ({
  id: index + 1,
  name,
  conclusion: "success" as const,
  url: `https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/${index + 1}`,
}));
const startEvidence = {
  schemaVersion: 1 as const,
  phase: "start" as const,
  workflowRunId: "123",
  releaseSha: head,
  productionOrigin: GROK_CAUSAL_PRODUCTION_ORIGIN,
  supabaseProjectRef: GROK_CAUSAL_SUPABASE_PROJECT,
  projectId: uuid("1"),
  projectName: "Causal acceptance",
  repository: "surgeservicesllc/SoftwareFactory",
  defaultBranch: "main",
  goalSha256: digest,
  contextSha256: "d".repeat(64),
  sessionId: uuid("2"),
  graphId: uuid("3"),
  returnPath: `/solutions/factory/grok?projectId=${uuid("1")}&sessionId=${uuid("2")}&graphId=${uuid("3")}`,
  initialGraphRunId: uuid("4"),
  draftGraphRunId: uuid("18"),
  graphRunIds: [uuid("4"), uuid("18")],
  wake: {
    intentId: uuid("5"), controlRevision: 2, dispatchAttemptId: uuid("6"),
    receiptId: uuid("7"), workerId: "graph-worker-1",
    dispatchRecordedAt: "2026-08-31T12:01:00.000Z",
    acknowledgedAt: "2026-08-31T12:01:01.000Z",
    protocolVersion: 1 as const, capabilityVersion: 1 as const,
  },
  claude: { completedNodeRunIds: [uuid("8")] },
  phase1c: { bridgeId: uuid("9"), commandId: uuid("10"), taskId: uuid("11"), agentRunId: uuid("12") },
  pullRequest: {
    id: uuid("13"), number: 500, url: "https://github.com/surgeservicesllc/SoftwareFactory/pull/500",
    headBranch: "factory/grok-causal-123", baseBranch: "main", headSha: "e".repeat(40),
  },
  checks,
  recordedAt: "2026-08-31T12:00:00.000Z",
};

describe("Grok causal production acceptance workflow", () => {
  it("is manual-only, first-attempt owner-bound, least privilege, and serialized", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      "phase", "confirm", "release_sha", "project_id", "project_name",
      "repository", "default_branch", "start_run_id", "start_evidence_sha256",
    ]);
    expect(workflow.permissions).toEqual({
      actions: "read", checks: "read", contents: "read", deployments: "read",
      "pull-requests": "read",
    });
    expect(workflow.concurrency).toEqual({
      group: "apply-hosted-migrations", "cancel-in-progress": false,
    });
    expect(workflow.jobs.acceptance["timeout-minutes"]).toBe(330);
    const authorize = step("Authorize one exact causal acceptance phase").run ?? "";
    for (const proof of [
      GROK_CAUSAL_START_CONFIRM, GROK_CAUSAL_FINISH_CONFIRM,
      "PRODUCTION_RELEASE_ACTOR", "GITHUB_ACTOR", "GITHUB_TRIGGERING_ACTOR",
      "GITHUB_RUN_ATTEMPT", '"1"', "surgeservicesllc/SoftwareFactory", "refs/heads/main",
    ]) expect(`${source}\n${authorize}`).toContain(proof);
  });

  it("pins exact production, Supabase, current main, READY Vercel, and four exact checks", () => {
    expect(workflow.jobs.acceptance.env).toMatchObject({
      PROJECT_REF: GROK_CAUSAL_SUPABASE_PROJECT,
      PRODUCTION_ORIGIN: GROK_CAUSAL_PRODUCTION_ORIGIN,
      PRODUCTION_HEALTH_URL: `${GROK_CAUSAL_PRODUCTION_ORIGIN}/api/health`,
    });
    const verify = step("Verify exact main CI Vercel Supabase and worker policy").run ?? "";
    for (const proof of [
      "CURRENT_MAIN_SHA", "GITHUB_SHA", '.creator.login=="vercel[bot]"',
      '.releaseSha==$sha', '.databaseProjectRef==$project',
      "SOFTWAREFACTORY_GRAPH_WORKER_ENABLED", "SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED",
      "SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED", "SOFTWAREFACTORY_AUTH_BROKER_DISABLED",
      ...GROK_CAUSAL_REQUIRED_CHECKS,
    ]) expect(`${source}\n${verify}`).toContain(proof);
  });

  it("uses a dedicated secret account, disables capture, and permits only create then Resume in start", () => {
    const start = step("Start one new exact docs-only Grok lifecycle");
    expect(start.env?.GROK_CAUSAL_E2E_EMAIL).toBe("${{ secrets.GROK_CAUSAL_PRODUCTION_EMAIL }}");
    expect(start.env?.GROK_CAUSAL_E2E_PASSWORD).toBe("${{ secrets.GROK_CAUSAL_PRODUCTION_PASSWORD }}");
    expect(start.env?.PLAYWRIGHT_BASE_URL).toBe(GROK_CAUSAL_PRODUCTION_ORIGIN);
    for (const capture of ['trace: "off"', 'screenshot: "off"', 'video: "off"']) {
      expect(spec).toContain(capture);
    }
    expect(spec).toContain('url.pathname === "/api/grok/sessions"');
    expect(spec).toContain("/control");
    expect(spec).toContain("expect(createPosts).toBe(1)");
    expect(spec).toContain("expect(resumePosts).toBe(1)");
    expect(spec).toContain("expect(unexpectedMutations).toEqual([])");
    expect(spec).toContain("workerAcknowledged");
    expect(spec).toContain("workerWoken");
    expect(spec).toContain("protocolVersion");
    expect(spec).toContain("capabilityVersion");
    expect(step("Publish exact owner-only architecture handoff").run).toContain("ARCHITECTURE gate");
  });

  it("never merges, deploys, dispatches, changes variables, applies migrations, or weakens safety", () => {
    expect(source).not.toMatch(/\bgh\s+(?:pr\s+merge|workflow\s+run|variable\s+(?:set|delete))\b/i);
    expect(source).not.toMatch(/\/dispatches\b|\/merges\b|\/git\/refs\b.*(?:-X|--request)\s*(?:POST|PATCH|PUT|DELETE)/i);
    expect(source).not.toMatch(/\bsupabase\s+(?:db\s+push|migration\s+(?:up|repair))\b/i);
    expect(source).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
    expect(source).not.toMatch(/(?:auto_merge|auto_deploy|auto_approve)\s*=\s*true/i);
    expect(source).not.toMatch(/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/i);
    expect(step("Upload immutable start evidence").uses).toBe(
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    );
    expect(step("Download exact immutable start evidence").uses).toBe(
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
    );
  });

  it("binds finish to the exact artifact digest, same session, merge, deployment, and read-only browser", () => {
    const prior = step("Verify and read exact start evidence").run ?? "";
    expect(prior).toContain("sha256sum");
    expect(prior).toContain("validate-grok-causal-evidence.mts start");
    const merged = step("Verify exact separately merged PR and unchanged head checks").run ?? "";
    for (const proof of [
      '.merged==true', ".merge_commit_sha==$merge", ".head.sha==$head",
      "docs/grok-causal-acceptance/", ".id==$id", ".conclusion==\"success\"",
    ]) expect(merged).toContain(proof);
    expect(spec).toContain("finishes by reading the exact accepted session without a mutation");
    expect(spec).toContain("unexpectedMutations: unexpectedMutations.length");
    expect(cli).toContain("grokCausalStartEvidenceSchema");
    expect(cli).toContain("grokCausalFinishEvidenceSchema");
  });

  it("strictly validates bounded secret-free start and finish artifacts", () => {
    expect(grokCausalStartEvidenceSchema.parse(startEvidence)).toEqual(startEvidence);
    const finishEvidence = {
      schemaVersion: 1 as const, phase: "finish" as const, workflowRunId: "456",
      startWorkflowRunId: "123", startEvidenceSha256: digest,
      startReleaseSha: head, releaseSha: release,
      productionOrigin: GROK_CAUSAL_PRODUCTION_ORIGIN,
      supabaseProjectRef: GROK_CAUSAL_SUPABASE_PROJECT,
      projectId: startEvidence.projectId, repository: startEvidence.repository,
      defaultBranch: "main", sessionId: startEvidence.sessionId,
      graphId: startEvidence.graphId,
      initialGraphRunId: startEvidence.initialGraphRunId,
      draftGraphRunId: startEvidence.draftGraphRunId,
      terminalGraphRunId: uuid("19"),
      graphRunIds: [...startEvidence.graphRunIds, uuid("19")],
      wakeReceiptId: startEvidence.wake.receiptId,
      bridgeId: startEvidence.phase1c.bridgeId, agentRunId: startEvidence.phase1c.agentRunId,
      pullRequest: { id: startEvidence.pullRequest.id, number: 500, headSha: startEvidence.pullRequest.headSha, mergeCommitSha: release },
      deployment: {
        id: uuid("14"), externalId: 321, url: "https://softwarefactory-example-surgeservices-projects.vercel.app",
        monitorObservationId: uuid("15"), validationId: uuid("16"), terminalArtifactId: uuid("17"),
      },
      checks, recordedAt: "2026-08-31T13:00:00.000Z",
    };
    expect(grokCausalFinishEvidenceSchema.parse(finishEvidence)).toEqual(finishEvidence);
    expect(() => grokCausalFinishEvidenceSchema.parse({ ...finishEvidence, releaseSha: head })).toThrow();
    expect(() => grokCausalStartEvidenceSchema.parse({
      ...startEvidence,
      graphRunIds: [startEvidence.initialGraphRunId, startEvidence.initialGraphRunId],
    })).toThrow();
    expect(() => grokCausalStartEvidenceSchema.parse({
      ...startEvidence,
      returnPath: "/solutions/factory/grok?projectId=wrong",
    })).toThrow();
    expect(() => grokCausalStartEvidenceSchema.parse({ ...startEvidence, password: "forbidden" })).toThrow();
  });
});
