// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ProposedFileChange } from "@/lib/providers/types";
import { reviewProposedDiff, type DiffReviewInput } from "@/lib/worker/diff-review";
import { scanContentForSecrets } from "@/lib/worker/secret-scan";

const SHA = "a".repeat(40);

function change(overrides: Partial<ProposedFileChange> = {}): ProposedFileChange {
  return {
    path: "components/widget.tsx",
    action: "update",
    content: "export function Widget() { return null; }\n",
    expectedSha: SHA,
    summary: "Adjust the widget",
    ...overrides,
  };
}

function input(overrides: Partial<DiffReviewInput> = {}): DiffReviewInput {
  return {
    changes: [change()],
    knownFileShas: new Map([["components/widget.tsx", SHA]]),
    expectedPaths: [],
    declaredRisk: "YELLOW",
    providerRiskFactors: [],
    providerBlockers: [],
    expectsChanges: true,
    ...overrides,
  };
}

describe("diff review", () => {
  it("approves an in-scope change with a matching expected SHA", () => {
    const review = reviewProposedDiff(input());

    expect(review.approved).toBe(true);
    expect(review.findings).toEqual([]);
    expect(review.acceptedChanges).toHaveLength(1);
  });

  it("blocks a protected path", () => {
    const review = reviewProposedDiff(
      input({
        changes: [change({ path: "supabase/migrations/001_x.sql", expectedSha: SHA })],
        knownFileShas: new Map([["supabase/migrations/001_x.sql", SHA]]),
      }),
    );

    expect(review.approved).toBe(false);
    expect(review.findings.map((finding) => finding.blocker)).toContain("protected_resource");
    expect(review.acceptedChanges).toEqual([]);
  });

  it("blocks every protected class the policy names", () => {
    for (const path of [
      "AI/CURRENT_STATE.md",
      "policies/RISK_CLASSIFICATION.md",
      ".github/workflows/ci.yml",
      "app/api/commands/route.ts",
      "lib/supabase/server.ts",
      "lib/github/client.ts",
      "AGENTS.md",
      "vercel.json",
      ".env.example",
      "app/auth/auth-form.tsx",
    ]) {
      const review = reviewProposedDiff(
        input({
          changes: [change({ path, expectedSha: SHA })],
          knownFileShas: new Map([[path.toLowerCase(), SHA]]),
        }),
      );
      expect(review.findings.map((finding) => finding.blocker), path).toContain("protected_resource");
    }
  });

  it("refuses an update to a file the worker was never shown", () => {
    const review = reviewProposedDiff(input({ knownFileShas: new Map() }));

    expect(review.approved).toBe(false);
    expect(review.findings.map((finding) => finding.blocker)).toContain("missing_expected_sha");
  });

  it("refuses an update whose expected SHA does not match what was supplied", () => {
    const review = reviewProposedDiff(
      input({ knownFileShas: new Map([["components/widget.tsx", "b".repeat(40)]]) }),
    );

    expect(review.approved).toBe(false);
    expect(review.findings.map((finding) => finding.blocker)).toContain("missing_expected_sha");
  });

  it("reports paths outside the planned scope", () => {
    const review = reviewProposedDiff(input({ expectedPaths: ["components/other.tsx"] }));

    expect(review.approved).toBe(false);
    expect(review.unexpectedPaths).toEqual(["components/widget.tsx"]);
    expect(review.findings.map((finding) => finding.blocker)).toContain("out_of_scope");
  });

  it("blocks proposed content containing a credential", () => {
    const review = reviewProposedDiff(
      input({
        changes: [
          change({ content: 'const token = "ghp_abcdefghijklmnopqrstuvwxyz012345";\n' }),
        ],
      }),
    );

    expect(review.approved).toBe(false);
    expect(review.secretFindings.length).toBeGreaterThan(0);
    expect(review.findings.map((finding) => finding.blocker)).toContain("secret_detected");
  });

  it("recalculates risk upward and refuses to run above the planned level", () => {
    const review = reviewProposedDiff(
      input({ declaredRisk: "GREEN", providerRiskFactors: ["secrets-or-credentials"] }),
    );

    expect(review.recalculatedRisk).toBe("RED");
    expect(review.approved).toBe(false);
    expect(review.findings.map((finding) => finding.blocker)).toContain("risk_ceiling_exceeded");
  });

  it("surfaces blockers the worker itself reported", () => {
    const review = reviewProposedDiff(input({ providerBlockers: ["The requested file is protected"] }));

    expect(review.approved).toBe(false);
    expect(review.findings.map((finding) => finding.blocker)).toContain("provider_reported_blockers");
  });

  it("allows an investigation to finish without proposing changes", () => {
    const review = reviewProposedDiff(input({ changes: [], expectsChanges: false }));

    expect(review.approved).toBe(true);
    expect(review.findings).toEqual([]);
  });

  it("requires changes from a code-changing task", () => {
    const review = reviewProposedDiff(input({ changes: [], expectsChanges: true }));

    expect(review.approved).toBe(false);
    expect(review.findings.map((finding) => finding.blocker)).toContain("no_changes_proposed");
  });

  it("rejects oversized proposed content", () => {
    const review = reviewProposedDiff(
      input({ changes: [change({ content: "x".repeat(300 * 1024) })] }),
    );

    expect(review.findings.map((finding) => finding.blocker)).toContain("file_too_large");
  });
});

describe("diff secret scanning", () => {
  it("detects known vendor credential formats", () => {
    expect(scanContentForSecrets("a.ts", 'const k = "sk-abcdefghijklmnopqrstuvwxyz01";')).toHaveLength(1);
    expect(scanContentForSecrets("a.ts", "AKIAIOSFODNN7EXAMPLE")).toHaveLength(1);
    expect(scanContentForSecrets("a.pem", "-----BEGIN RSA PRIVATE KEY-----")[0].reason).toBe(
      "private_key_block",
    );
  });

  it("detects a literal assigned to a secret-named variable with no vendor prefix", () => {
    const findings = scanContentForSecrets("config.ts", 'const clientSecret = "9f2c1a7e55b04d33af61";');

    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe("secret_assignment");
    expect(findings[0].line).toBe(1);
  });

  it("does not flag placeholders, env references, or examples", () => {
    for (const line of [
      'const apiKey = process.env.OPENAI_API_KEY ?? "";',
      'const password = "your-password-here";',
      'const token = "xxxxxxxxxxxxxxxxxxxx";',
      'const secret = "<replace-me>";',
      'const clientSecret = "${VAULT_SECRET}";',
    ]) {
      expect(scanContentForSecrets("config.ts", line), line).toEqual([]);
    }
  });

  it("flags a concrete value in an environment file but not an empty template", () => {
    expect(scanContentForSecrets(".env.local", "OPENAI_API_KEY=9f2c1a7e55b04d33af61")).toHaveLength(1);
    expect(scanContentForSecrets(".env.example", "OPENAI_API_KEY=")).toEqual([]);
  });

  it("reports the exact line of a finding", () => {
    const findings = scanContentForSecrets("a.ts", ["// ok", "// ok", 'const password = "1a2b3c4d5e6f7g8h";'].join("\n"));

    expect(findings[0].line).toBe(3);
  });
});

describe("secret scanning performance bounds", () => {
  it("scans a very long single line quickly instead of backtracking", () => {
    // A minified bundle is one enormous line. Unbounded regex input here would
    // stall the worker, so the scanner slices each line before matching.
    const minified = `const a=${"x".repeat(250 * 1024)};`;
    const started = Date.now();
    const findings = scanContentForSecrets("bundle.js", minified);

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(findings).toEqual([]);
  });

  it("still finds a credential buried far inside a long line", () => {
    const buried = `${"x".repeat(120 * 1024)} ghp_abcdefghijklmnopqrstuvwxyz012345 ${"y".repeat(1000)}`;

    expect(scanContentForSecrets("bundle.js", buried)).toHaveLength(1);
  });
});
