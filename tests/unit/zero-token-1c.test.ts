// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  acceptanceCriteriaFor,
  branchNameFor,
  buildHandoffPackage,
  classifyCommand,
  HandoffRefusedError,
  renderHandoff,
} from "@/lib/orchestrator/handoff";
import {
  assertExecutionAllowed,
  assessExecution,
  CostPolicyViolationError,
  meteredCredentialsPresent,
  readCostPolicy,
  zeroCostStatus,
} from "@/lib/worker/cost-policy";

const SHA = "a".repeat(40);

function handoffInput(overrides: Record<string, unknown> = {}) {
  return {
    runId: "3f2b1c4d-0000-4000-8000-000000000001",
    commandId: "cmd-1",
    projectId: "proj-1",
    repositoryFullName: "surgeservicesllc/SoftwareFactory",
    baseBranch: "main",
    baseSha: SHA,
    prompt: "Document the Phase 1C canary in the AI folder",
    ...overrides,
  } as Parameters<typeof buildHandoffPackage>[0];
}

describe("the cost policy", () => {
  it("refuses metered calls when the flag is unset", () => {
    const policy = readCostPolicy({});

    expect(policy.paidApiCallsAllowed).toBe(false);
    expect(policy.reason).toContain("unset");
  });

  it("treats anything other than the exact string true as refusal", () => {
    // The expensive mistake is reading an ambiguous value as permission.
    for (const raw of ["TRUE", "True", "1", "yes", "", " true "]) {
      expect(readCostPolicy({ PAID_AI_API_CALLS_ALLOWED: raw }).paidApiCallsAllowed, raw).toBe(false);
    }
    expect(readCostPolicy({ PAID_AI_API_CALLS_ALLOWED: "true" }).paidApiCallsAllowed).toBe(true);
  });

  it("allows every mechanism that does not bill per token", () => {
    const policy = readCostPolicy({});

    for (const mechanism of ["DETERMINISTIC", "CODEX_HANDOFF", "PLATFORM_AUTOMATION"] as const) {
      const assessment = assessExecution(mechanism, policy);
      expect(assessment.allowed, mechanism).toBe(true);
      expect(assessment.metered, mechanism).toBe(false);
    }
  });

  it("blocks a metered call and names the alternative", () => {
    const assessment = assessExecution("METERED_API", readCostPolicy({}));

    expect(assessment.allowed).toBe(false);
    expect(assessment.metered).toBe(true);
    expect(assessment.detail).toContain("CODEX_HANDOFF");
  });

  it("throws a violation rather than degrading quietly", () => {
    expect(() => assertExecutionAllowed("METERED_API", readCostPolicy({}))).toThrow(
      CostPolicyViolationError,
    );
    // The non-metered paths must stay usable, or the guard would stop all work.
    expect(() => assertExecutionAllowed("CODEX_HANDOFF", readCostPolicy({}))).not.toThrow();
  });

  it("permits a metered call only under an explicit opt-in", () => {
    const policy = readCostPolicy({ PAID_AI_API_CALLS_ALLOWED: "true" });
    expect(assessExecution("METERED_API", policy).allowed).toBe(true);
  });
});

describe("the zero-cost status surface", () => {
  it("reports names of metered credentials, never values", () => {
    const present = meteredCredentialsPresent({ OPENAI_API_KEY: "sk-should-not-appear" });

    expect(present).toEqual(["OPENAI_API_KEY"]);
    expect(JSON.stringify(present)).not.toContain("sk-should-not-appear");
  });

  it("ignores an empty credential rather than counting it as configured", () => {
    expect(meteredCredentialsPresent({ OPENAI_API_KEY: "   " })).toEqual([]);
  });

  it("distinguishes no key from a key nothing may spend", () => {
    const clean = zeroCostStatus({});
    expect(clean.zeroCostEnforced).toBe(true);
    expect(clean.summary).toContain("No metered provider credential");

    const configured = zeroCostStatus({ ANTHROPIC_API_KEY: "x".repeat(30) });
    expect(configured.zeroCostEnforced).toBe(true);
    // Collapsing these two into one state would hide a real configuration.
    expect(configured.meteredCredentialsConfigured).toEqual(["ANTHROPIC_API_KEY"]);
    expect(configured.summary).toContain("should be removed");
  });

  it("says plainly when the zero-cost guarantee is off", () => {
    const status = zeroCostStatus({ PAID_AI_API_CALLS_ALLOWED: "true" });

    expect(status.zeroCostEnforced).toBe(false);
    expect(status.summary).toContain("may incur per-token charges");
  });
});

describe("deterministic classification", () => {
  it("is stable for the same command", () => {
    const a = classifyCommand("Fix the failing pagination test");
    const b = classifyCommand("Fix the failing pagination test");

    // A model that classified inconsistently would make the risk gate
    // decorative, which is the whole reason this is rules rather than a call.
    expect(a).toEqual(b);
  });

  it("puts schema and infrastructure work at RED", () => {
    expect(classifyCommand("Add a migration for the audit table").risk).toBe("RED");
    expect(classifyCommand("Update the deploy workflow").risk).toBe("RED");
  });

  it("raises risk on reach rather than topic", () => {
    // A documentation change that touches authentication is not a
    // documentation change.
    const result = classifyCommand("Document how the authentication tokens are issued");

    expect(result.kind).toBe("DOCUMENTATION");
    expect(result.risk).toBe("RED");
    expect(result.reasons.some((r) => r.includes("authentication"))).toBe(true);
  });

  it("escalates on inflected forms, not just exact words", () => {
    // The first version of these patterns ended each alternative with \b, so
    // "tokens" and "authentication" did not match "token" and "auth". Every
    // miss failed in the under-escalating direction, which is the one that
    // matters, so each inflection is pinned rather than trusted.
    for (const prompt of [
      "Document the tokens",
      "Explain authorization",
      "Note the credentials",
      "Describe deleting a row",
      "Summarise merging strategy",
      "Write up the deployment",
    ]) {
      expect(classifyCommand(prompt).risk, prompt).toBe("RED");
    }
  });

  it("treats an unrecognised command as YELLOW, not GREEN", () => {
    const result = classifyCommand("zxcv qwer asdf");

    expect(result.kind).toBe("UNKNOWN");
    expect(result.risk).toBe("YELLOW");
    expect(result.reasons[0]).toContain("rather than assumed simple");
  });

  it("never lowers risk below the kind floor", () => {
    expect(classifyCommand("Add a migration").risk).toBe("RED");
    expect(classifyCommand("Update the readme").risk).toBe("GREEN");
  });
});

describe("acceptance criteria", () => {
  it("always requires the four gates and the draft-PR boundary", () => {
    const criteria = acceptanceCriteriaFor(classifyCommand("Update the readme"));

    expect(criteria.some((c) => c.includes("npm run build"))).toBe(true);
    expect(criteria.some((c) => c.includes("draft pull request"))).toBe(true);
    expect(criteria.some((c) => c.includes("No credential"))).toBe(true);
  });

  it("requires a failing-first test for a bug fix", () => {
    const criteria = acceptanceCriteriaFor(classifyCommand("Fix the broken export"));

    expect(criteria.some((c) => c.includes("fails without the fix"))).toBe(true);
  });
});

describe("the handoff package", () => {
  it("builds a complete package for GREEN work", () => {
    const pkg = buildHandoffPackage(handoffInput());

    expect(pkg.classification.risk).toBe("GREEN");
    expect(pkg.mechanism).toBe("CODEX_HANDOFF");
    expect(pkg.cost.metered).toBe(false);
    expect(pkg.branchName).toMatch(/^factory\/3f2b1c4d-0000-4000-8000-000000000001-/);
    expect(pkg.validationCommands).toHaveLength(4);
  });

  it("refuses to package RED work", () => {
    // Producing a ready-to-run package for RED would put the dangerous thing
    // one accidental paste away from happening.
    expect(() => buildHandoffPackage(handoffInput({ prompt: "Drop the sessions table" }))).toThrow(
      /RED/,
    );
  });

  it("refuses a base SHA that is not exact", () => {
    expect(() => buildHandoffPackage(handoffInput({ baseSha: "abc1234" }))).toThrow(
      HandoffRefusedError,
    );
  });

  it("refuses to package metered execution under the zero-token policy", () => {
    expect(() => buildHandoffPackage(handoffInput({ mechanism: "METERED_API" }))).toThrow(
      /bills per token/,
    );
  });

  it("forbids reintroducing a paid API key", () => {
    const pkg = buildHandoffPackage(handoffInput());

    // The specific failure this guards: an executor clears a blocker by
    // setting a key and nobody notices the meter started.
    expect(pkg.forbiddenActions.some((a) => a.includes("OPENAI_API_KEY"))).toBe(true);
    expect(pkg.forbiddenActions.some((a) => a.includes("merging"))).toBe(true);
  });

  it("renders text an executor can act on without a parser", () => {
    const rendered = renderHandoff(buildHandoffPackage(handoffInput()));

    expect(rendered).toContain("Base: main at " + SHA);
    expect(rendered).toContain("## Done means all of these");
    expect(rendered).toContain("## You must not");
    expect(rendered).toContain("npm run typecheck");
  });
});

describe("branch naming", () => {
  it("matches the factory branch contract", () => {
    const branch = branchNameFor("3F2B1C4D-0000-4000-8000-000000000001", "Add a Canary Doc!");

    expect(branch).toBe("factory/3f2b1c4d-0000-4000-8000-000000000001-add-a-canary-doc");
  });

  it("never produces a trailing separator or an empty slug", () => {
    expect(branchNameFor("r", "!!!")).toBe("factory/r-change");
    expect(branchNameFor("r", "a".repeat(80))).not.toMatch(/-$/);
  });
});
