// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowSource = readFileSync(
  resolve(root, ".github/workflows/apply-hosted-migrations.yml"),
  "utf8",
);
const workflow = parse(workflowSource) as {
  on: { workflow_dispatch: { inputs: { scope: { options: string[] } } } };
  permissions: Record<string, string>;
  jobs: { apply: { steps: Array<{ name: string; if?: string; run?: string }> } };
};

const scopes = {
  fence: {
    name: "graph-protocol-fence",
    step: "Fence the legacy graph protocol (scope=graph-protocol-fence)",
    path: "supabase/migrations/20260827000150_fence_legacy_graph_protocol.sql",
    hash: "a4b505841d94cc89dfc82e24837dedb78356b56c5f5698c0748f8b6735341a49",
    version: "20260827000150",
  },
  lineage: {
    name: "graph-phase1c-lineage",
    step: "Install graph Phase 1C release lineage (scope=graph-phase1c-lineage)",
    path: "supabase/migrations/20260827000200_graph_phase1c_release_lineage.sql",
    hash: "23197552df3f442ae8264bf71bd28a7c479e09a64bf6e298c615b767a96572be",
    version: "20260827000200",
  },
} as const;

const steps = workflow.jobs.apply.steps;

function stepByName(name: string) {
  return steps.find((candidate) => candidate.name === name)!;
}

function canRun(candidate: { if?: string }, scope: string): boolean {
  const guard = candidate.if ?? "";
  if ([...guard.matchAll(/inputs\.scope\s*!=\s*'([^']+)'/g)].some((match) => match[1] === scope)) {
    return false;
  }
  const includes = [...guard.matchAll(/inputs\.scope\s*==\s*'([^']+)'/g)].map((match) => match[1]);
  return includes.length === 0 || includes.includes(scope);
}

function mutatesMigrationState(candidate: { run?: string }): boolean {
  const run = candidate.run ?? "";
  return /\bpsql\b[\s\S]*?\s-f\s/m.test(run)
    || /\bsupabase\s+migration\s+repair\b/.test(run)
    || /\bsupabase\s+db\s+push\b/.test(run);
}

describe("hosted graph protocol cutover scopes", () => {
  it("stays below GitHub Actions' workflow-file ceiling with release headroom", () => {
    // GitHub refuses to plan jobs for a workflow over 500 KB and leaves a
    // dispatch queued with zero jobs. Keep a deliberate margin so comments or
    // a small new scope cannot silently strand the production release path.
    //
    // The ceiling ratchets DOWN, never up. It reached ~2KB of headroom while
    // the CRM increments each carried their verification inline; extracting
    // those postflights to .github/hosted-apply/postflight/ recovered 16KB,
    // and lowering the number is what keeps the recovery. The commercial
    // portal scope breached 480,000 outright, and extracting the three
    // remaining inline heredoc guards to .github/hosted-apply/guard/
    // recovered another 4.8KB — so the number comes down again. A new scope
    // should cost ~22 lines here and a file there. If this fails, extract —
    // do not raise it.
    const canonicalLfSource = workflowSource.replace(/\r\n?/g, "\n");
    expect(Buffer.byteLength(canonicalLfSource, "utf8")).toBeLessThan(450_000);
  });

  it("exposes each protected phase exactly once and grants Actions read for the fleet check", () => {
    const options = workflow.on.workflow_dispatch.inputs.scope.options;
    expect(options.filter((value) => value === scopes.fence.name)).toEqual([scopes.fence.name]);
    expect(options.filter((value) => value === scopes.lineage.name)).toEqual([scopes.lineage.name]);
    expect(workflow.permissions.actions).toBe("read");
  });

  it.each([scopes.fence, scopes.lineage])(
    "$name has one and only one migration-mutating path",
    (scope) => {
      expect(stepByName(scope.step).if).toBe(`\${{ inputs.scope == '${scope.name}' }}`);
      expect(
        steps.filter((candidate) => canRun(candidate, scope.name))
          .filter(mutatesMigrationState)
          .map((candidate) => candidate.name),
      ).toEqual([scope.step]);
    },
  );

  it.each([scopes.fence, scopes.lineage])(
    "$name pins and stages only $path",
    (scope) => {
      const run = stepByName(scope.step).run ?? "";
      const migration = readFileSync(resolve(root, scope.path), "utf8").replace(/\r\n?/g, "\n");
      expect(createHash("sha256").update(migration).digest("hex")).toBe(scope.hash);
      expect(run.match(/supabase\/migrations\/[A-Za-z0-9_.-]+\.sql/g)).toEqual([scope.path]);
      expect(run.match(/(?<=EXPECTED_SHA256=)[a-f0-9]{64}/g)).toEqual([scope.hash]);
      expect(run).toContain("STAGE_DIR=$(mktemp -d)");
      expect(run).toContain('find "$STAGE_DIR" -maxdepth 1 -type f');
      expect(run.match(/-f "\$STAGED_FILE"/g)).toHaveLength(1);
      expect(run).toContain("--single-transaction");
      expect(run).toContain(
        `insert into supabase_migrations.schema_migrations (version) values ('${scope.version}')`,
      );
      expect(run).not.toMatch(/migration\s+repair|supabase\s+db\s+push/);
    },
  );

  it("binds both phases to exact main/repository/project and exact green deployed identity", () => {
    const release = stepByName(
      "Verify exact green release and stopped workers before graph protocol cutover",
    );
    expect(release.if).toContain("inputs.scope == 'graph-protocol-fence'");
    expect(release.if).toContain("inputs.scope == 'graph-phase1c-lineage'");
    const gate = release.run ?? "";
    for (const evidence of [
      "surgeservicesllc/SoftwareFactory",
      "refs/heads/main",
      "Lint, typecheck, test, and build",
      "Browser and accessibility tests 1/3",
      "Browser and accessibility tests 2/3",
      "Browser and accessibility tests 3/3",
      ".environment == \"Production\"",
      ".creator.login == \"vercel[bot]\"",
      "graph-worker.yml",
      "codex-worker.yml",
      "select(.status != \"completed\")",
    ]) expect(gate).toContain(evidence);

    for (const scope of [scopes.fence, scopes.lineage]) {
      const run = stepByName(scope.step).run ?? "";
      expect(run).toContain('"surgeservicesllc/SoftwareFactory"');
      expect(run).toContain('"refs/heads/main"');
      expect(run).toContain('"qpuofpmagrmyamahqwxw"');
      expect(run).toContain('"$(git rev-parse HEAD)"');
    }
  });

  it("commits the fence before the lineage scope can accept a completely drained fleet", () => {
    const fence = stepByName(scopes.fence.step).run ?? "";
    const lineage = stepByName(scopes.lineage.step).run ?? "";
    expect(fence).toContain('if [ "$LEDGER" != "1|0|0" ]');
    expect(fence).toContain("Legacy authority is fenced");
    expect(fence).toContain("do not apply 00200 until this reads 0|0");

    expect(lineage).toContain('if [ "$LEDGER" != "1|1|0" ]');
    const drain = lineage.indexOf("DRAINED=$(psql");
    const apply = lineage.indexOf("--single-transaction");
    expect(drain).toBeGreaterThanOrEqual(0);
    expect(apply).toBeGreaterThan(drain);
    for (const evidence of [
      "pg_stat_activity",
      "pg_locks",
      "phase1c_workers",
      "graph_runs",
      "agent_runs",
      "autonomy_kill_switch_active",
      "auto_rollback",
      "claim_planned_graph_v2",
      "diagnose_graph_queue_as_worker_v2",
      "abort_graph_run_as_worker",
      "relrowsecurity",
      "relforcerowsecurity",
    ]) expect(lineage).toContain(evidence);
  });

  it("makes scope=all prove both protected rows and hashes before db push", () => {
    const broad = stepByName("Push the outstanding migrations (scope=all)").run ?? "";
    const fence = broad.indexOf("PROTECTED_GRAPH_PROTOCOL_FENCE=");
    const lineage = broad.indexOf("PROTECTED_GRAPH_PHASE1C_LINEAGE=");
    const catalog = broad.indexOf("PROTECTED_GRAPH_PROTOCOL_READY=");
    const push = broad.search(/\bsupabase\s+db\s+push\b/);
    expect(fence).toBeGreaterThanOrEqual(0);
    expect(lineage).toBeGreaterThan(fence);
    expect(catalog).toBeGreaterThan(lineage);
    expect(push).toBeGreaterThan(catalog);
    expect(broad).toContain('if [ "$PROTECTED_GRAPH_PROTOCOL_FENCE" != "1" ]');
    expect(broad).toContain('if [ "$PROTECTED_GRAPH_PHASE1C_LINEAGE" != "1" ]');
    expect(broad).toContain(scopes.fence.hash);
    expect(broad).toContain(scopes.lineage.hash);
    expect(broad).toContain("scope=graph-protocol-fence");
    expect(broad).toContain("scope=graph-phase1c-lineage");
  });
});
