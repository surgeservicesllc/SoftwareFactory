// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("worker admitted runtime contract", () => {
  it("constructs a claimed Grok Phase 1C adapter only from its exact admitted credential", async () => {
    const source = await readFile(resolve(repositoryRoot, "scripts/worker.mts"), "utf8");
    const factory = source.slice(source.indexOf("codex: async (job) =>"));
    expect(factory).toContain("job.executionAdmission");
    expect(factory).toContain("resolveAdmittedCodexAuth({");
    expect(factory.indexOf("resolveAdmittedCodexAuth({")).toBeLessThan(
      factory.indexOf("CodexSdkAdapter.create(auth)"),
    );
    expect(factory).toContain("configuration.resolveLegacyCodexAuth()");
    expect(factory).toContain("job.provider !== job.executionAdmission.provider");
    expect(factory).toContain("job.model !== job.executionAdmission.model");
    expect(source).not.toMatch(/const\s+codex\s*=\s*CodexSdkAdapter\.create\(configuration\.codexAuth\)/);
    expect(source.indexOf("resolveLegacyCodexAuth()")).toBeGreaterThan(
      source.indexOf("job.executionAdmission"),
    );
  });

  it("keeps ordinary startup preflight credential-free and reserves ambient auth for explicit probes", async () => {
    const source = await readFile(resolve(repositoryRoot, "scripts/worker-preflight.mts"), "utf8");
    const startupBranch = source.slice(
      source.indexOf("if (!executeProbe)"),
      source.indexOf("} else {", source.indexOf("if (!executeProbe)")),
    );
    expect(startupBranch).toContain("verifyWorkerRuntime");
    expect(startupBranch).not.toContain("resolveCodexAuth");
  });

  it("never routes an admitted OpenAI node through Claude or an ambient account", async () => {
    const source = await readFile(resolve(repositoryRoot, "scripts/graph-worker.mts"), "utf8");
    expect(source).toContain("resolveAdmittedClaudeAuth({");
    expect(source).toContain("claimedNode?.execution_admission ?? null");
    expect(source).toContain("if (admission)");
    expect(source).toContain("exactModel = admission.model");
    expect(source).toContain("tryResolveClaudeAuth()");
    expect(source).toMatch(
      /if \(admission\) \{[\s\S]*?resolveAdmittedClaudeAuth\([\s\S]*?\} else \{[\s\S]*?tryResolveClaudeAuth\(\)/,
    );
  });
});
