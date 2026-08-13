import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.join(process.cwd(), ".github/workflows/codex-worker.yml"),
  "utf8",
);

describe("Phase 1C durable worker workflow", () => {
  it("runs only from default-branch dispatch or the scheduled recovery wake-up", () => {
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toContain("softwarefactory_phase1c_command");
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain('cron: "*/5 * * * *"');
    expect(workflow).not.toMatch(/\bpush:\s*$/m);
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
    expect(workflow).toContain("SOFTWAREFACTORY_OPENAI_API_KEY");
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
      ?.split("- name: Claim and execute one durable run")[0] ?? "";
    expect(installStep).not.toContain("secrets.");
  });

  it("claims one durable run through the fail-closed worker entrypoint", () => {
    expect(workflow).toContain("if: ${{ vars.SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED == 'true' }}");
    expect(workflow).toContain('SOFTWAREFACTORY_WORKER_ENABLED: "true"');
    expect(workflow).toContain("npm run worker:once");
    expect(workflow).toContain("timeout-minutes: 70");
  });
});
