// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseWorkerResult, workerResultJsonSchema } from "@/lib/providers/contract";
import { buildWorkerPrompt } from "@/lib/providers/prompt";
import type { WorkerRunRequest } from "@/lib/providers/types";
import { branchSlug, buildPullRequestBody, workingBranchName } from "@/lib/worker/runner";
import { isAuthorizedWorkerRequest, isWorkerTickConfigured, WorkerNotConfiguredError } from "@/lib/worker/tick";

const SHA = "a".repeat(40);
const SECRET = "0123456789abcdef0123456789abcdef0123456789";

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Repaired the mobile drawer focus trap.",
    changes: [
      {
        path: "components/nav.tsx",
        action: "update",
        content: "export const Nav = () => null;",
        expectedSha: SHA,
        summary: "Restore the focus trap",
      },
    ],
    warnings: [],
    blockers: [],
    securityFindings: [],
    riskFactors: ["isolated-reversible-ui"],
    nextRecommendation: null,
    ...overrides,
  };
}

describe("worker result contract", () => {
  it("accepts a well-formed structured result", () => {
    const result = parseWorkerResult(validResult());

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].expectedSha).toBe(SHA);
  });

  it("rejects an update that omits the expected blob SHA", () => {
    expect(() =>
      parseWorkerResult(validResult({ changes: [{ ...validResult().changes[0], expectedSha: null }] })),
    ).toThrow();
  });

  it("rejects path traversal", () => {
    expect(() =>
      parseWorkerResult(validResult({ changes: [{ ...validResult().changes[0], path: "../outside.ts" }] })),
    ).toThrow();
  });

  it("rejects the same path proposed twice", () => {
    const duplicate = validResult().changes[0];
    expect(() => parseWorkerResult(validResult({ changes: [duplicate, duplicate] }))).toThrow(
      /same path twice/i,
    );
  });

  it("rejects an unknown risk factor rather than trusting the model's vocabulary", () => {
    expect(() => parseWorkerResult(validResult({ riskFactors: ["totally-safe-trust-me"] }))).toThrow();
  });

  it("rejects unexpected top-level fields", () => {
    expect(() => parseWorkerResult(validResult({ executeImmediately: true }))).toThrow();
  });

  it("normalizes a leading ./ in a proposed path", () => {
    const result = parseWorkerResult(
      validResult({ changes: [{ ...validResult().changes[0], path: "./components/nav.tsx" }] }),
    );

    expect(result.changes[0].path).toBe("components/nav.tsx");
  });

  it("keeps the JSON schema mirror strict so a provider cannot add fields", () => {
    expect(workerResultJsonSchema.additionalProperties).toBe(false);
    expect(workerResultJsonSchema.required).toContain("changes");
    expect(workerResultJsonSchema.properties.changes.items.additionalProperties).toBe(false);
  });
});

describe("worker prompt", () => {
  function request(overrides: Partial<WorkerRunRequest> = {}): WorkerRunRequest {
    return {
      runId: "11111111-1111-4111-8111-111111111111",
      objective: "Repair the mobile navigation drawer",
      acceptanceCriteria: "Keyboard focus stays trapped while the drawer is open.",
      workType: "code_change",
      repository: "surgeservicesllc/SoftwareFactory",
      baseBranch: "main",
      baseSha: SHA,
      model: "gpt-5-codex",
      protectedPathGuidance: ["AI/**", "policies/**"],
      memory: [{ path: "AGENTS.md", content: "# rules", sha: SHA, truncated: false }],
      files: [{ path: "components/nav.tsx", content: "export const Nav = () => null;", sha: SHA, truncated: false }],
      priorFailure: null,
      maxOutputTokens: 32_000,
      ...overrides,
    };
  }

  it("includes the objective, protected paths, and per-file expected SHAs", () => {
    const prompt = buildWorkerPrompt(request());

    expect(prompt).toContain("Repair the mobile navigation drawer");
    expect(prompt).toContain("Protected paths — never change these");
    expect(prompt).toContain("AI/**");
    expect(prompt).toContain(`expectedSha: ${SHA}`);
    expect(prompt).toContain("Acceptance criteria");
  });

  it("marks a file with no known SHA as ineligible for update", () => {
    const prompt = buildWorkerPrompt(
      request({ files: [{ path: "a.ts", content: "x", sha: null, truncated: false }] }),
    );

    expect(prompt).toContain("expectedSha: unavailable");
  });

  it("passes a real CI failure back for repair without inviting a workaround", () => {
    const prompt = buildWorkerPrompt(
      request({
        priorFailure: { kind: "ci", summary: "2 CI check(s) failed.", details: ["lint: failure"] },
      }),
    );

    expect(prompt).toContain("Real CI failure from your previous attempt");
    expect(prompt).toContain("lint: failure");
    expect(prompt).toContain("Do not disable, skip, or weaken a failing check");
  });

  it("truncates rather than sending an unbounded file", () => {
    const prompt = buildWorkerPrompt(
      request({ files: [{ path: "big.ts", content: "x".repeat(200_000), sha: SHA, truncated: false }] }),
    );

    expect(prompt).toContain("truncated by SoftwareFactory");
    expect(prompt.length).toBeLessThan(200_000);
  });
});

describe("worker branch and pull request", () => {
  it("names a branch under the factory namespace", () => {
    const branch = workingBranchName("11111111-1111-4111-8111-111111111111", "Repair mobile navigation");

    expect(branch.startsWith("factory/")).toBe(true);
    expect(branch).toMatch(/^factory\/[A-Za-z0-9._-]+$/);
  });

  it("produces a safe slug from an awkward title", () => {
    expect(branchSlug("  Fix!! the ***thing*** (again)  ")).toBe("fix-the-thing-again");
    expect(branchSlug("!!!")).toBe("work");
  });

  it("states in the pull request body that nothing was merged or deployed", () => {
    const body = buildPullRequestBody({
      runId: "run-1",
      commandPrompt: "Fix mobile navigation",
      taskTitle: "Repair mobile navigation",
      summary: "Restored the focus trap.",
      risk: "GREEN",
      acceptanceCriteria: "Focus stays trapped.",
      changedPaths: ["components/nav.tsx"],
      warnings: [],
      securityFindings: [],
      baseBranch: "main",
      workingBranch: "factory/run-1-repair",
    });

    expect(body).toContain("Run ID");
    expect(body).toContain("Fix mobile navigation");
    expect(body).toContain("components/nav.tsx");
    expect(body).toContain("**draft**");
    expect(body).toContain("did not approve, merge, or deploy it");
    expect(body).toContain("Rollback");
    expect(body).toContain("does not run this repository's test suite itself");
  });
});

describe("worker tick authorization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function tickRequest(token?: string) {
    return new Request("https://factory.test/api/worker/tick", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  it("refuses to run at all when no credential is configured", () => {
    vi.stubEnv("WORKER_TICK_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");

    expect(isWorkerTickConfigured()).toBe(false);
    expect(() => isAuthorizedWorkerRequest(tickRequest(SECRET))).toThrow(WorkerNotConfiguredError);
  });

  it("refuses a credential shorter than the minimum length", () => {
    vi.stubEnv("WORKER_TICK_SECRET", "too-short");
    vi.stubEnv("CRON_SECRET", "");

    expect(isWorkerTickConfigured()).toBe(false);
    expect(() => isAuthorizedWorkerRequest(tickRequest("too-short"))).toThrow(WorkerNotConfiguredError);
  });

  it("accepts the exact credential and rejects everything else", () => {
    vi.stubEnv("WORKER_TICK_SECRET", SECRET);
    vi.stubEnv("CRON_SECRET", "");

    expect(isAuthorizedWorkerRequest(tickRequest(SECRET))).toBe(true);
    expect(isAuthorizedWorkerRequest(tickRequest(`${SECRET}x`))).toBe(false);
    expect(isAuthorizedWorkerRequest(tickRequest(SECRET.replace(/0/g, "1")))).toBe(false);
    expect(isAuthorizedWorkerRequest(tickRequest())).toBe(false);
  });

  it("also accepts the platform scheduler credential", () => {
    vi.stubEnv("WORKER_TICK_SECRET", "");
    vi.stubEnv("CRON_SECRET", SECRET);

    expect(isWorkerTickConfigured()).toBe(true);
    expect(isAuthorizedWorkerRequest(tickRequest(SECRET))).toBe(true);
  });

  it("ignores a non-bearer authorization scheme", () => {
    vi.stubEnv("WORKER_TICK_SECRET", SECRET);
    const request = new Request("https://factory.test/api/worker/tick", {
      method: "POST",
      headers: { authorization: `Basic ${SECRET}` },
    });

    expect(isAuthorizedWorkerRequest(request)).toBe(false);
  });
});
