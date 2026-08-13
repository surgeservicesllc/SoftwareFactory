import { describe, expect, it } from "vitest";

import { assessDiffRisk, reclassifyAgainstDeclared } from "@/lib/autonomy/diff-risk";

const file = (path: string, addedLines?: string[]) => ({ path, addedLines });

describe("assessDiffRisk", () => {
  it("treats an empty diff as YELLOW, not GREEN", () => {
    const assessment = assessDiffRisk([]);

    expect(assessment.level).toBe("YELLOW");
    expect(assessment.defaulted).toBe(true);
    expect(assessment.reasons[0]).toMatch(/no recognised change signal/i);
  });

  it("classifies documentation and tests as GREEN", () => {
    expect(assessDiffRisk([file("AI/CURRENT_STATE.md"), file("README.md")]).level).toBe("GREEN");
    expect(assessDiffRisk([file("tests/unit/thing.test.ts")]).level).toBe("GREEN");
  });

  it("classifies presentation-only changes as GREEN", () => {
    expect(assessDiffRisk([file("components/site-header.tsx"), file("app/globals.css")]).level)
      .toBe("GREEN");
  });

  it("classifies server behavior and schema as YELLOW", () => {
    expect(assessDiffRisk([file("lib/marketing/queries.ts")]).level).toBe("YELLOW");
    expect(assessDiffRisk([file("supabase/migrations/20260101000000_add_column.sql")]).level)
      .toBe("YELLOW");
    expect(assessDiffRisk([file("package.json")]).level).toBe("YELLOW");
  });

  it.each([
    [".env.local", "environment"],
    ["app/auth/callback/route.ts", "authentication"],
    ["policies/AUTO_MERGE_POLICY.md", "policy"],
    ["vercel.json", "hosting"],
    [".github/workflows/ci.yml", "workflow"],
    ["lib/billing/stripe.ts", "billing"],
  ])("classifies %s as RED", (path) => {
    expect(assessDiffRisk([file(path)]).level).toBe("RED");
  });

  it("takes the highest risk when a diff spans several classes", () => {
    const assessment = assessDiffRisk([
      file("README.md"),
      file("components/thing.tsx"),
      file("supabase/migrations/20260101000000_x.sql"),
      file("app/auth/route.ts"),
    ]);

    expect(assessment.level).toBe("RED");
    expect(assessment.factors).toContain("documentation-only");
    expect(assessment.factors).toContain("authentication-or-security-controls");
  });

  it("detects credential-shaped content regardless of the path", () => {
    const assessment = assessDiffRisk([
      file("lib/util.ts", ["const key = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';"]),
    ]);

    expect(assessment.level).toBe("RED");
    expect(assessment.factors).toContain("secrets-or-credentials");
  });

  it("detects a private key block", () => {
    const assessment = assessDiffRisk([
      file("config/thing.ts", ["-----BEGIN RSA PRIVATE KEY-----"]),
    ]);
    expect(assessment.level).toBe("RED");
  });

  it.each([
    "drop table public.projects;",
    "truncate table public.audit_events;",
    "alter table public.projects disable row level security;",
    "drop policy projects_select on public.projects;",
    "delete from public.projects;",
  ])("flags the destructive statement %s as RED", (statement) => {
    const assessment = assessDiffRisk([
      file("supabase/migrations/20260101000000_x.sql", [statement]),
    ]);

    expect(assessment.level).toBe("RED");
    expect(assessment.factors).toContain("destructive-production-data");
  });

  it("leaves a bounded delete at the ordinary schema level", () => {
    const assessment = assessDiffRisk([
      file("supabase/migrations/20260101000000_x.sql", [
        "delete from public.stale_rows where created_at < now() - interval '30 days';",
      ]),
    ]);

    expect(assessment.factors).not.toContain("destructive-production-data");
    expect(assessment.level).toBe("YELLOW");
  });

  it("reports the paths that drove the classification, sorted and deduplicated", () => {
    const assessment = assessDiffRisk([
      file("lib/b.ts"),
      file("lib/a.ts"),
      file("lib/a.ts"),
    ]);

    expect(assessment.triggeringPaths).toEqual(["lib/a.ts", "lib/b.ts"]);
  });

  it("gives a readable reason for every factor it found", () => {
    const assessment = assessDiffRisk([file(".env.production")]);

    expect(assessment.reasons.length).toBeGreaterThan(0);
    for (const reason of assessment.reasons) {
      expect(reason.length).toBeGreaterThan(0);
      expect(reason).toMatch(/\.$/);
    }
  });

  it("never lets absent content lower the risk of a dangerous path", () => {
    // No addedLines supplied at all — the path rule still has to fire.
    expect(assessDiffRisk([{ path: ".env" }]).level).toBe("RED");
  });
});

describe("reclassifyAgainstDeclared", () => {
  it("reports escalation when the finished diff is riskier", () => {
    const result = reclassifyAgainstDeclared("GREEN", [
      file("supabase/migrations/20260101000000_x.sql"),
    ]);

    expect(result.assessment.level).toBe("YELLOW");
    expect(result.escalated).toBe(true);
    expect(result.deescalated).toBe(false);
  });

  it("reports de-escalation separately, and it never widens anything", () => {
    const result = reclassifyAgainstDeclared("RED", [file("README.md")]);

    expect(result.assessment.level).toBe("GREEN");
    expect(result.escalated).toBe(false);
    expect(result.deescalated).toBe(true);
  });

  it("reports neither when the declaration was accurate", () => {
    const result = reclassifyAgainstDeclared("GREEN", [file("docs/thing.md")]);

    expect(result.escalated).toBe(false);
    expect(result.deescalated).toBe(false);
  });
});
