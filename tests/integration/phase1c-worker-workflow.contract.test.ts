import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.join(process.cwd(), ".github/workflows/codex-worker.yml"),
  "utf8",
);

const graphWorkflow = readFileSync(
  path.join(process.cwd(), ".github/workflows/graph-worker.yml"),
  "utf8",
);

describe("Phase 1C durable worker workflow", () => {
  it("keeps every graph-worker trigger behind one exact global activation gate", () => {
    expect(graphWorkflow).toContain(
      "if: ${{ vars.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED == 'true' && (github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main') && (github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch' || vars.SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED == 'true') }}",
    );
    expect(graphWorkflow).toContain('SOFTWAREFACTORY_GRAPH_WORKER_ENABLED: "true"');
  });
  it("runs from dispatch, the scheduled recovery wake-up, or main-guarded manual dispatch", () => {
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toContain("softwarefactory_phase1c_command");
    expect(workflow).toContain("softwarefactory_phase1c_preflight");
    // Owner-ordered 2026-08-16: manual dispatch is enabled. The job guard is
    // the contract that keeps it from executing a non-main ref's job with the
    // workflow's secrets — a dispatch of any other branch is skipped.
    expect(workflow).toMatch(/workflow_dispatch:\s*\r?\n\s+inputs:\s*\r?\n\s+command_id:/);
    expect(workflow).toContain(
      "(github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main')",
    );
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain('cron: "*/5 * * * *"');
    expect(workflow).not.toMatch(/\bpush:\s*$/m);
  });

  it("cannot consume per-token API credit, because no step receives a paid key", () => {
    // The cost rule stated as a contract on the deployed workflow rather than
    // as an intention: a run cannot bill what it was never given.
    // Matches an actual environment assignment, not the mere mention of a name
    // — the workflow documents the rule in a comment, and forbidding the word
    // would ban the explanation along with the practice.
    expect(workflow).not.toMatch(/^\s*(OPENAI|ANTHROPIC)_API_KEY:/m);
    expect(workflow).not.toMatch(/secrets\.SOFTWAREFACTORY_OPENAI_API_KEY/);
    expect(workflow).not.toMatch(/^\s*SOFTWAREFACTORY_CODEX_AUTH_MODE:\s*api_key/m);
    // Subscription credentials are what it does receive.
    expect(workflow).toContain("SOFTWAREFACTORY_CODEX_AUTH_JSON: ${{ secrets.SOFTWAREFACTORY_CODEX_AUTH_JSON }}");
  });

  it("does not give the workflow token repository write authority", () => {
    expect(workflow).toMatch(/permissions:\s*\r?\n\s+contents: read/);
    expect(workflow).not.toMatch(/pull-requests:\s*write/);
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("npm ci --ignore-scripts --no-audit --no-fund");
    expect(workflow).toContain("SOFTWAREFACTORY_WORKER_RUNTIME: docker");
    expect(workflow).toContain("docker pull node:22.22.0-bookworm@sha256:20a424ecd1d2064a44e12fe287bf3dae443aab31dc5e0c0cb6c74bef9c78911c");
    expect(workflow).toContain("actions/checkout@11d5960a326750d5838078e36cf38b85af677262");
    expect(workflow).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
    expect(workflow).not.toMatch(/uses:\s+actions\/(?:checkout|setup-node)@v\d+/);
  });

  it("uses server-only secrets, an isolated temp workspace, and the approved identity", () => {
    expect(workflow).toContain("SOFTWAREFACTORY_CODEX_AUTH_JSON");
    expect(workflow).toContain("SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY");
    expect(workflow).toContain("GITHUB_APP_ID: ${{ secrets.SOFTWAREFACTORY_GITHUB_APP_ID }}");
    expect(workflow).toContain("GITHUB_APP_PRIVATE_KEY_BASE64: ${{ secrets.SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64 }}");
    expect(workflow).toContain("GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64: ${{ secrets.SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64 }}");
    expect(workflow).not.toMatch(/secrets\.GITHUB_/);
    expect(workflow).toContain("${{ runner.temp }}/softwarefactory-worker");
    expect(workflow).toContain("GITHUB_COMMIT_IDENTITY_NAME: surgeservicesllc");
    expect(workflow).toContain("GITHUB_COMMIT_IDENTITY_EMAIL: surgeservicesllc@gmail.com");
    expect(workflow).not.toContain("NEXT_PUBLIC_OPENAI");
    const installStep = workflow.split("- name: Install the locked worker runtime")[1]
      ?.split("- name: Verify the pinned Codex CLI")[0] ?? "";
    expect(installStep).not.toContain("secrets.");
  });

  it("verifies the worker before a dispatched run can consume a durable attempt", () => {
    const preflightSection = workflow.split("- name: Verify the pinned Codex CLI")[1]
      ?.split("- name: Preload the pinned validation sandbox")[0] ?? "";
    const modelStep = preflightSection.split("- name: Report the resolved authentication")[0] ?? "";
    const preflightIndex = workflow.indexOf("- name: Verify the pinned Codex CLI");
    const claimIndex = workflow.indexOf("- name: Claim and execute one durable run");

    expect(preflightIndex).toBeGreaterThan(0);
    expect(claimIndex).toBeGreaterThan(preflightIndex);
    expect(modelStep).not.toContain("if:");
    expect(preflightSection).toContain("SOFTWAREFACTORY_CODEX_AUTH_JSON: ${{ secrets.SOFTWAREFACTORY_CODEX_AUTH_JSON }}");
    expect(preflightSection).toContain("npm run worker:preflight");
    expect(preflightSection).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(preflightSection).not.toContain("GITHUB_APP_PRIVATE_KEY");
    expect(preflightSection).toContain("github.event.action == 'softwarefactory_phase1c_preflight'");
    expect(preflightSection).toContain("npm run worker:preflight -- --execute");
    expect(preflightSection).toContain("without claiming a run");
    expect(workflow).toMatch(/Preload the pinned validation sandbox\r?\n\s+if: \$\{\{ github\.event\.action != 'softwarefactory_phase1c_preflight' \}\}/);
    expect(workflow).toMatch(/Claim and execute one durable run\r?\n\s+if: \$\{\{ github\.event\.action != 'softwarefactory_phase1c_preflight' \}\}/);
    expect(workflow).not.toContain("preflight_only");
  });

  it("claims one durable run through the fail-closed worker entrypoint", () => {
    expect(workflow).toContain("if: ${{ vars.SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED == 'true' && (github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main') }}");
    expect(workflow).toContain('SOFTWAREFACTORY_WORKER_ENABLED: "true"');
    expect(workflow).toContain("npm run worker:once");
    expect(workflow).toContain("SOFTWAREFACTORY_TARGET_COMMAND_ID:");
    expect(workflow).toContain("github.event.client_payload.command_id || inputs.command_id || ''");
    expect(workflow).toContain("SOFTWAREFACTORY_TARGET_CLAIM_REQUIRED:");
    expect(workflow).toContain("timeout-minutes: 70");
  });
});
