// @vitest-environment node

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

const requiredMemoryFiles = [
  "AI/PROJECT_CONTEXT.md",
  "AI/CURRENT_STATE.md",
  "AI/ARCHITECTURE.md",
  "AI/ROADMAP.md",
  "AI/BACKLOG.md",
  "AI/DECISIONS.md",
  "AI/HANDOFF.md",
  "AI/QUALITY_SCORECARD.md",
] as const;

const requiredPolicyFiles = [
  "policies/RISK_CLASSIFICATION.md",
  "policies/AUTO_MERGE_POLICY.md",
  "policies/PROTECTED_RESOURCES.md",
  "policies/AUTO_ROLLBACK.md",
  "policies/POST_DEPLOY_VALIDATION.md",
] as const;

function readRepositoryFile(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("repository memory contract", () => {
  it.each([...requiredMemoryFiles, ...requiredPolicyFiles])(
    "%s exists and contains substantive guidance",
    (relativePath) => {
      const absolutePath = resolve(repositoryRoot, relativePath);

      expect(statSync(absolutePath).isFile()).toBe(true);
      expect(readRepositoryFile(relativePath).trim().length).toBeGreaterThan(80);
    },
  );

  it("instructs future agents to read every required memory and policy file", () => {
    const agentInstructions = readRepositoryFile("AGENTS.md");

    for (const relativePath of [
      ...requiredMemoryFiles,
      ...requiredPolicyFiles,
    ]) {
      expect(agentInstructions, `AGENTS.md must reference ${relativePath}`).toContain(
        relativePath,
      );
    }
  });

  it("documents all risk tiers and the non-optional RED approval gate", () => {
    const riskPolicy = readRepositoryFile("policies/RISK_CLASSIFICATION.md");

    expect(riskPolicy).toMatch(/\bGREEN\b/i);
    expect(riskPolicy).toMatch(/\bYELLOW\b/i);
    expect(riskPolicy).toMatch(/\bRED\b/i);
    expect(riskPolicy).toMatch(
      /owner approval is mandatory for every RED action in Phase 1/i,
    );
  });
});
