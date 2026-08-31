// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
let migration = "";
let worker = "";
let workspace = "";
let workflow = "";

beforeAll(async () => {
  [migration, worker, workspace, workflow] = await Promise.all([
    readFile(resolve(root, "supabase/migrations/20260831002000_exact_graph_repository_workspace.sql"), "utf8"),
    readFile(resolve(root, "scripts/graph-worker.mts"), "utf8"),
    readFile(resolve(root, "lib/worker/graph-workspace.ts"), "utf8"),
    readFile(resolve(root, ".github/workflows/graph-worker.yml"), "utf8"),
  ]);
});

describe("exact graph repository workspace contract", () => {
  it("exposes a bounded service-only target and revalidates every field in the claim transaction", () => {
    for (const name of [
      "resolve_graph_execution_target_as_worker",
      "claim_planned_graph_by_target_v4",
      "launch_grok_read_only_research_v3_as_server",
    ]) {
      expect(migration).toMatch(new RegExp(
        `create function public\\.${name}\\([\\s\\S]*?security definer\\s+set search_path = pg_catalog`,
        "i",
      ));
      expect(migration).toMatch(new RegExp(
        `revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated, service_role;[\\s\\S]*?grant execute on function public\\.${name}\\([\\s\\S]*?to service_role;`,
        "i",
      ));
    }
    for (const field of [
      "external_installation_id", "app_id", "external_repository_id",
      "repository_full_name", "base_branch", "base_sha",
      "required_check_names", "required_checks_sha256", "target_sha256",
    ]) {
      expect(migration).toContain(`'${field}'`);
    }
    expect(migration).toMatch(
      /v_target := public\.resolve_graph_execution_target_as_worker[\s\S]*?v_target is distinct from p_expected_target[\s\S]*?claim_planned_graph_by_id_v3[\s\S]*?resolve_graph_execution_target_as_worker[\s\S]*?is distinct from v_target/i,
    );
  });

  it("prepares and verifies a detached no-hooks read-only tree without running target code", () => {
    expect(workspace).toContain("--separate-git-dir=");
    expect(workspace).toContain("core.hooksPath");
    expect(workspace).toContain("core.fsmonitor=false");
    expect(workspace).toContain("submodule.recurse=false");
    expect(workspace).toContain('["fetch", "--no-tags", "--depth=1", "origin", target.base_sha]');
    expect(workspace).toContain('["checkout", "--detach", "--force", target.base_sha]');
    expect(workspace).toContain("assertGraphWorkspaceIdentity");
    expect(workspace).toContain("rejectSymlinks(directory)");
    expect(workspace).toContain("await unlink(gitPointer)");
    expect(workspace).toContain("await setTreeReadOnly(directory)");
    expect(workspace).not.toMatch(/(?:npm|pnpm|yarn|node)\s+(?:install|run|exec)/i);
  });

  it("resolves and prepares the exact target before claim or provider execution", () => {
    const resolveIndex = worker.indexOf(".resolve(targetGraphId)");
    const tokenIndex = worker.indexOf("new GitHubGraphReadTokenProvider().createToken");
    const workspaceIndex = worker.indexOf("workspaceManager.withWorkspace");
    const claimIndex = worker.indexOf("store.claimPlannedGraph()");
    const providerIndex = worker.indexOf("const executor = buildClaudeNodeExecutor");
    expect(resolveIndex).toBeGreaterThan(0);
    expect(tokenIndex).toBeGreaterThan(resolveIndex);
    expect(workspaceIndex).toBeGreaterThan(tokenIndex);
    expect(claimIndex).toBeGreaterThan(workspaceIndex);
    expect(providerIndex).toBeGreaterThan(claimIndex);
    expect(worker).toContain("workingDirectory: workspace.directory");
    expect(worker).not.toContain("process.cwd()");
    expect(worker).not.toContain("GITHUB_REPOSITORY");
  });

  it("makes schedule/global draining inert until an equally exact target exists", () => {
    expect(workflow).toContain("github.event_name != 'schedule'");
    expect(workflow).toContain("github.event.client_payload.graph_id != '' || inputs.graph_id != ''");
    expect(workflow).toContain("SOFTWAREFACTORY_TARGET_GRAPH_ID:");
    expect(workflow).toContain("npx tsx scripts/graph-worker.mts --once");
    expect(workflow).not.toContain("--drain");
    expect(worker).toContain("if (!once || drain)");
  });
});
