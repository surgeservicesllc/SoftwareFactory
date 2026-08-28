// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(
  import.meta.dirname,
  "../../.github/workflows/bootstrap-blackstone-supabase-auth.yml",
);
const source = readFileSync(workflowPath, "utf8");

interface WorkflowStep {
  readonly name: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly run?: string;
}

interface BootstrapWorkflow {
  readonly on: {
    readonly workflow_dispatch: {
      readonly inputs: {
        readonly confirm: {
          readonly description: string;
          readonly required: boolean;
          readonly type: string;
        };
      };
    };
  };
  readonly permissions: Readonly<Record<string, never>>;
  readonly jobs: {
    readonly bootstrap: {
      readonly if: string;
      readonly env: Readonly<Record<string, string>>;
      readonly steps: readonly WorkflowStep[];
    };
  };
}

const workflow = parse(source) as BootstrapWorkflow;
const job = workflow.jobs.bootstrap;
const commands = job.steps.map((step) => step.run ?? "").join("\n");

describe("the exact Blackstone Supabase Auth bootstrap workflow", () => {
  it("has only a confirmation-gated manual trigger and no GitHub token permissions", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(["confirm"]);
    expect(workflow.on.workflow_dispatch.inputs.confirm).toEqual({
      description:
        'Type "CONFIRM BLACKSTONE SUPABASE AUTH BOOTSTRAP" exactly',
      required: true,
      type: "string",
    });
    expect(workflow.permissions).toEqual({});
  });

  it("is fixed to exact main, project, email, actor, triggering actor, and first attempt", () => {
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(job.if).toContain(
      "inputs.confirm == 'CONFIRM BLACKSTONE SUPABASE AUTH BOOTSTRAP'",
    );
    expect(job.if).toContain("vars.PRODUCTION_RELEASE_ACTOR != ''");
    expect(job.if).toContain("github.actor == vars.PRODUCTION_RELEASE_ACTOR");
    expect(job.if).toContain(
      "github.triggering_actor == vars.PRODUCTION_RELEASE_ACTOR",
    );
    expect(job.if).toContain("github.run_attempt == 1");
    expect(job.env).toEqual({
      PROJECT_REF: "qpuofpmagrmyamahqwxw",
      TARGET_EMAIL: "blackstoneagencyllc@gmail.com",
    });
    for (const identity of [
      'GITHUB_REPOSITORY" != "surgeservicesllc/SoftwareFactory',
      'GITHUB_REF" != "refs/heads/main',
      'GITHUB_ACTOR" != "$AUTHORIZED_ACTOR',
      'GITHUB_TRIGGERING_ACTOR" != "$AUTHORIZED_ACTOR',
      'GITHUB_RUN_ATTEMPT" != "1',
      'PROJECT_REF" != "qpuofpmagrmyamahqwxw',
      'TARGET_EMAIL" != "blackstoneagencyllc@gmail.com',
    ]) {
      expect(commands).toContain(identity);
    }
  });

  it("uses only the two protected repository secrets and never embeds or logs their values", () => {
    const reconcile = job.steps.find((step) =>
      step.name.startsWith("Idempotently reconcile"),
    );
    expect(reconcile?.env).toEqual({
      BOOTSTRAP_PASSWORD:
        "${{ secrets.BLACKSTONE_SUPABASE_BOOTSTRAP_PASSWORD }}",
      SERVICE_ROLE_KEY:
        "${{ secrets.SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY }}",
    });
    expect(commands).toContain('echo "::add-mask::$BOOTSTRAP_PASSWORD"');
    expect(commands).toContain('echo "::add-mask::$SERVICE_ROLE_KEY"');
    expect(commands).not.toMatch(/set\s+-x/);
    expect(commands).not.toMatch(/console\.(?:log|error|warn)\s*\(/);
    expect(commands).not.toMatch(
      /process\.(?:stdout|stderr)\.write\([^\n]*(?:responseText|responseBody|password|serviceRoleKey)/,
    );
    expect(source.match(/\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}/g)?.sort()).toEqual([
      "${{ secrets.BLACKSTONE_SUPABASE_BOOTSTRAP_PASSWORD }}",
      "${{ secrets.SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY }}",
    ]);
  });

  it("idempotently creates or updates through the exact GoTrue Admin API", () => {
    expect(commands).toContain(
      "const authBaseUrl = `https://${projectRef}.supabase.co/auth/v1`",
    );
    expect(commands).toContain('adminRequest("/admin/users", "POST"');
    expect(commands).toContain(
      "adminRequest(`/admin/users/${encodeURIComponent(user.id)}`, \"PUT\"",
    );
    expect(commands).toContain("created.body?.user ?? created.body");
    expect(commands).toContain("updated.body?.user ?? updated.body");
    expect(commands).toContain("email: targetEmail");
    expect(commands).toContain("password,");
    expect(commands.match(/email_confirm: true/g)).toHaveLength(2);
    expect(commands).toContain("user.email.toLowerCase() === targetEmail");
    expect(commands).toContain("matches.length > 1");
    expect(commands).toContain("finalMatches.length !== 1");
  });

  it("re-reads and verifies the exact confirmed identity before bounded output", () => {
    expect(commands).toContain(
      "const verified = await adminRequest(`/admin/users/${encodeURIComponent(user.id)}`)",
    );
    expect(commands).toContain("const verifiedUser = verified.body?.user ?? verified.body");
    expect(commands).toContain("verifiedUser?.email !== targetEmail");
    expect(commands).toContain("verifiedUser?.id !== user.id");
    expect(commands).toContain("verifiedUser?.email_confirmed_at");
    expect(commands).toContain("Number.isFinite(Date.parse(confirmedAt))");
    expect(commands).toContain(
      "process.stdout.write(`${operation} user_id=${user.id}\\n`)",
    );
    expect(commands).not.toContain("process.stdout.write(response");
    expect(commands).not.toContain("process.stderr.write(response");
  });
});
