import { describe, expect, it } from "vitest";

import {
  graphClaimTargetMismatch,
  graphExecutionTargetSchema,
  type GraphExecutionTarget,
} from "@/lib/worker/graph-target";

const target = Object.freeze({
  protocol_version: 1,
  graph_id: "10000000-0000-4000-8000-000000000001",
  organization_id: "10000000-0000-4000-8000-000000000002",
  project_id: "10000000-0000-4000-8000-000000000003",
  connection_id: "10000000-0000-4000-8000-000000000004",
  github_repository_id: "10000000-0000-4000-8000-000000000005",
  internal_installation_id: "10000000-0000-4000-8000-000000000006",
  external_installation_id: 123,
  app_id: 456,
  external_repository_id: 789,
  repository_full_name: "factory/target-repository",
  base_branch: "main",
  base_sha: "a".repeat(40),
  required_check_names: ["CI"],
  required_checks_sha256: "b".repeat(64),
  target_sha256: "c".repeat(64),
}) satisfies GraphExecutionTarget;

const claim = Object.freeze({
  graph_id: target.graph_id,
  organization_id: target.organization_id,
  project_id: target.project_id,
  project_repository: target.repository_full_name,
  base_branch: target.base_branch,
  base_sha: target.base_sha,
  required_check_names: target.required_check_names,
  required_checks_sha256: target.required_checks_sha256,
  repository_target_sha256: target.target_sha256,
});

describe("exact graph execution target", () => {
  it("accepts only the complete bounded protocol projection", () => {
    expect(graphExecutionTargetSchema.safeParse(target).success).toBe(true);
    expect(graphExecutionTargetSchema.safeParse({
      ...target,
      unexpected_secret_reference: "vault/path",
    }).success).toBe(false);
    expect(graphExecutionTargetSchema.safeParse({
      ...target,
      base_sha: "not-a-commit",
    }).success).toBe(false);
  });

  it("makes installation/repository changes visible through the target digest", () => {
    expect(graphClaimTargetMismatch(claim, target)).toBeNull();
    expect(graphClaimTargetMismatch(claim, {
      ...target,
      external_installation_id: 999,
      target_sha256: "d".repeat(64),
    })).toContain("installation, policy, and base identity");
    expect(graphClaimTargetMismatch({
      ...claim,
      project_repository: "factory/wrong-repository",
    }, target)).toContain("installation, policy, and base identity");
    expect(graphClaimTargetMismatch({
      ...claim,
      base_sha: "e".repeat(40),
    }, target)).toContain("installation, policy, and base identity");
  });
});
