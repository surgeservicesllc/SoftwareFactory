import { describe, expect, it } from "vitest";

import { REVIEW_AGENTS, runReviewAgents, type AgentReviewInput } from "@/lib/autonomy/agents";
import { assessDiffRisk } from "@/lib/autonomy/diff-risk";
import { GREEN_GATES, type GateResult } from "@/lib/autonomy/gates";

const passingGates: GateResult[] = GREEN_GATES.map((gate) => ({ gate, outcome: "passed" as const }));

function input(overrides: Partial<AgentReviewInput> = {}): AgentReviewInput {
  const files = overrides.files ?? [
    { path: "components/thing.tsx" },
    { path: "tests/unit/thing.test.tsx" },
  ];
  return {
    files,
    assessment: overrides.assessment ?? assessDiffRisk(files),
    gateResults: overrides.gateResults ?? passingGates,
    hasTestChanges: overrides.hasTestChanges,
  };
}

describe("agent coverage", () => {
  it("runs all three agents every time", () => {
    const result = runReviewAgents(input());
    expect(result.reports.map((report) => report.agent)).toEqual([...REVIEW_AGENTS]);
  });

  it("is clear on a well-formed, fully verified change", () => {
    const result = runReviewAgents(input());

    expect(result.clear).toBe(true);
    expect(result.blockingFindings).toEqual([]);
  });
});

describe("the review agent", () => {
  it("blocks source changes that carry no test", () => {
    const result = runReviewAgents(input({ files: [{ path: "lib/thing.ts" }] }));

    expect(result.clear).toBe(false);
    expect(result.blockingFindings.map((f) => f.code)).toContain("NO_TEST_EVIDENCE");
  });

  it("accepts an explicit statement that tests changed", () => {
    const result = runReviewAgents(input({ files: [{ path: "lib/thing.ts" }], hasTestChanges: true }));

    expect(result.findings.map((f) => f.code)).not.toContain("NO_TEST_EVIDENCE");
  });

  it("blocks an unreviewed diff", () => {
    const result = runReviewAgents(
      input({
        gateResults: passingGates.map((gate) =>
          gate.gate === "diff_review" ? { ...gate, outcome: "not_run" as const } : gate,
        ),
      }),
    );

    expect(result.blockingFindings.map((f) => f.code)).toContain("DIFF_NOT_REVIEWED");
  });

  it("blocks an empty diff", () => {
    const result = runReviewAgents(input({ files: [] }));
    expect(result.blockingFindings.map((f) => f.code)).toContain("EMPTY_DIFF");
  });

  it("notes a very large diff without blocking on it", () => {
    const files = Array.from({ length: 70 }, (_, index) => ({ path: `docs/page-${index}.md` }));
    const result = runReviewAgents(input({ files }));

    const large = result.findings.find((f) => f.code === "LARGE_DIFF");
    expect(large?.severity).toBe("advisory");
    expect(result.clear).toBe(true);
  });
});

describe("the QA agent", () => {
  it.each(["tests", "typecheck", "build"] as const)("blocks when %s failed", (gate) => {
    const result = runReviewAgents(
      input({
        gateResults: passingGates.map((entry) =>
          entry.gate === gate ? { ...entry, outcome: "failed" as const } : entry,
        ),
      }),
    );

    expect(result.blockingFindings.map((f) => f.code)).toContain(`${gate.toUpperCase()}_FAILED`);
  });

  it.each(["tests", "typecheck", "build"] as const)("blocks when %s never ran", (gate) => {
    const result = runReviewAgents(
      input({ gateResults: passingGates.filter((entry) => entry.gate !== gate) }),
    );

    expect(result.blockingFindings.map((f) => f.code)).toContain(`${gate.toUpperCase()}_NOT_RUN`);
  });

  it("treats a lint failure as advisory rather than blocking", () => {
    const result = runReviewAgents(
      input({
        gateResults: passingGates.map((entry) =>
          entry.gate === "lint" ? { ...entry, outcome: "failed" as const } : entry,
        ),
      }),
    );

    expect(result.findings.find((f) => f.code === "LINT_FAILED")?.severity).toBe("advisory");
    expect(result.clear).toBe(true);
  });
});

describe("the security agent", () => {
  it("blocks when the secret scan did not pass", () => {
    const result = runReviewAgents(
      input({
        gateResults: passingGates.map((entry) =>
          entry.gate === "secret_scan" ? { ...entry, outcome: "not_run" as const } : entry,
        ),
      }),
    );

    expect(result.blockingFindings.map((f) => f.code)).toContain("SECRET_SCAN_NOT_PASSED");
  });

  it.each([
    [".env.production", "RED_FACTOR_SECRETS_OR_CREDENTIALS"],
    ["app/auth/route.ts", "RED_FACTOR_AUTHENTICATION_OR_SECURITY_CONTROLS"],
    ["vercel.json", "RED_FACTOR_DNS_OR_DOMAIN_OWNERSHIP"],
    [".github/workflows/ci.yml", "RED_FACTOR_PRIVILEGED_ACCESS"],
    ["lib/billing/charge.ts", "RED_FACTOR_MONEY_OR_BILLING"],
  ])("blocks %s and names the reason", (path, code) => {
    const files = [{ path }, { path: "tests/unit/x.test.ts" }];
    const result = runReviewAgents(input({ files, assessment: assessDiffRisk(files) }));

    expect(result.blockingFindings.map((f) => f.code)).toContain(code);
  });

  it("blocks a schema change that has no migration review", () => {
    const files = [
      { path: "supabase/migrations/20260101000000_x.sql" },
      { path: "tests/unit/x.test.ts" },
    ];
    const result = runReviewAgents(input({ files, assessment: assessDiffRisk(files) }));

    const finding = result.findings.find((f) => f.code === "SCHEMA_CHANGE");
    expect(finding?.severity).toBe("blocking");
  });

  it("downgrades the schema finding once a migration review passed", () => {
    const files = [
      { path: "supabase/migrations/20260101000000_x.sql" },
      { path: "tests/unit/x.test.ts" },
    ];
    const result = runReviewAgents(
      input({
        files,
        assessment: assessDiffRisk(files),
        gateResults: [...passingGates, { gate: "migration_review", outcome: "passed" }],
      }),
    );

    expect(result.findings.find((f) => f.code === "SCHEMA_CHANGE")?.severity).toBe("advisory");
    expect(result.clear).toBe(true);
  });
});

describe("finding aggregation", () => {
  it("marks the report of any agent that raised a blocking finding", () => {
    const result = runReviewAgents(input({ files: [{ path: "lib/thing.ts" }] }));

    expect(result.reports.find((r) => r.agent === "review")?.blocking).toBe(true);
    expect(result.reports.find((r) => r.agent === "qa")?.blocking).toBe(false);
  });

  it("collects every finding across agents", () => {
    const result = runReviewAgents(input({ files: [{ path: "lib/thing.ts" }], gateResults: [] }));

    const agents = new Set(result.findings.map((f) => f.agent));
    expect(agents.has("review")).toBe(true);
    expect(agents.has("qa")).toBe(true);
    expect(agents.has("security")).toBe(true);
  });

  it("gives every finding a code and a summary", () => {
    const result = runReviewAgents(input({ files: [{ path: ".env" }], gateResults: [] }));

    for (const finding of result.findings) {
      expect(finding.code).toMatch(/^[A-Z0-9_]+$/);
      expect(finding.summary.length).toBeGreaterThan(0);
    }
  });
});
