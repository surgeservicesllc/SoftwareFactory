// @vitest-environment node

import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  completeRpc: vi.fn(),
  createToken: vi.fn(),
  createBranch: vi.fn(),
  createDraftPullRequest: vi.fn(),
  getBranchReference: vi.fn(),
  getFile: vi.fn(),
  prepare: vi.fn(),
  reservationRpc: vi.fn(),
  updateFile: vi.fn(),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return {
    ...original,
    randomUUID: () => "60000000-0000-4000-8000-000000000001",
  };
});
vi.mock("@/lib/github/route", () => ({
  authorizeGitHubRepositoryRequest: harness.prepare,
  createGitHubRepositoryRequestToken: harness.createToken,
}));
vi.mock("@/lib/github/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/github/repository")>();
  return {
    ...original,
    createGitHubBranch: harness.createBranch,
    createGitHubDraftPullRequest: harness.createDraftPullRequest,
    getGitHubBranchReference: harness.getBranchReference,
    getGitHubFile: harness.getFile,
    updateGitHubFileOnBranch: harness.updateFile,
  };
});
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => ({ rpc: harness.completeRpc }),
}));

import { POST } from "@/app/api/github/repositories/[owner]/[repo]/changes/route";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const connectionId = "30000000-0000-4000-8000-000000000001";
const repositoryId = "40000000-0000-4000-8000-000000000001";
const userId = "50000000-0000-4000-8000-000000000001";
const path = "AI/BACKLOG.md";
const confirmation = `APPROVE RED DRAFT PR FOR ${path}`;
const fileSha = "a".repeat(40);

function requestBody(protectedApproval?: {
  confirmation: string;
  reason: string;
  rollbackPlan: string;
}) {
  return {
    baseBranch: "main",
    commitMessage: `Update ${path} via SoftwareFactory`,
    content: "Changed backlog",
    expectedBlobSha: fileSha,
    idempotencyKey: "sf:protected:0001",
    path,
    projectId,
    ...(protectedApproval ? { protectedApproval } : {}),
    title: `Update ${path} via SoftwareFactory`,
  };
}

function createRequest(body: ReturnType<typeof requestBody>) {
  return new Request(
    `https://softwarefactory.example/api/github/repositories/example/application/changes?connectionId=${connectionId}`,
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Origin: "https://softwarefactory.example" },
      method: "POST",
    },
  );
}

function preparedContext(role: "owner" | "admin") {
  const supabase = {
    from(table: string) {
      const result = table === "projects"
        ? {
          data: {
            default_branch: "main",
            github_repository: "example/application",
            id: projectId,
            organization_id: organizationId,
          },
          error: null,
        }
        : {
          data: { github_repository_id: repositoryId, id: "70000000-0000-4000-8000-000000000001" },
          error: null,
        };
      const chain = {
        eq: () => chain,
        maybeSingle: async () => result,
        select: () => chain,
      };
      return chain;
    },
    rpc: harness.reservationRpc,
  };
  return {
    context: {
      connectionId,
      organizationId,
      repository: {
        defaultBranch: "main",
        fullName: "example/application",
        id: repositoryId,
      },
      role,
    },
    owner: "example",
    repository: "application",
    supabase,
    user: { id: userId },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.prepare.mockResolvedValue(preparedContext("owner"));
  harness.createToken.mockResolvedValue("installation-token");
  harness.completeRpc.mockResolvedValue({ data: true, error: null });
  harness.getFile.mockResolvedValue({ content: "Original backlog", sha: fileSha });
  harness.getBranchReference.mockResolvedValue({ object: { sha: "b".repeat(40) } });
  harness.createBranch.mockResolvedValue(undefined);
  harness.updateFile.mockResolvedValue({
    commit: {
      html_url: `https://github.com/example/application/commit/${"c".repeat(40)}`,
      sha: "c".repeat(40),
    },
  });
  harness.createDraftPullRequest.mockResolvedValue({
    draft: true,
    html_url: "https://github.com/example/application/pull/21",
    id: 900001,
    number: 21,
    state: "open",
    title: `Update ${path} via SoftwareFactory`,
  });
  harness.reservationRpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "begin_github_change_provider_execution") {
      return Promise.resolve({ data: true, error: null });
    }
    return {
      single: async () => ({
      data: {
        base_branch: args.p_base_branch,
        commit_message: args.p_commit_message,
        commit_sha: null,
        commit_url: null,
        connection_id: args.p_connection_id,
        content_sha256: args.p_content_sha256,
        execution_nonce: args.p_execution_nonce,
        expected_blob_sha: args.p_expected_blob_sha,
        external_pull_request_id: null,
        head_branch: null,
        id: "80000000-0000-4000-8000-000000000001",
        path: args.p_path,
        project_id: args.p_project_id,
        pull_request_number: null,
        pull_request_url: null,
        repository_id: args.p_repository_id,
        reservation_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        status: "reserved",
        title: args.p_title,
      },
      error: null,
      }),
    };
  });
});

describe("protected GitHub change route", () => {
  it("returns a bounded approval requirement without reserving or writing", async () => {
    const response = await POST(
      createRequest(requestBody()),
      { params: Promise.resolve({ owner: "example", repo: "application" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(428);
    expect(body).toEqual({
      error: {
        code: "protected_resource_approval_required",
        constraints: {
          expiresInSeconds: 900,
          reason: { maxLength: 500, minLength: 20 },
          rollbackPlan: { maxLength: 500, minLength: 20 },
        },
        message: expect.any(String),
        path,
        requiredConfirmation: confirmation,
        risk: "RED",
      },
    });
    expect(JSON.stringify(body)).not.toContain("Changed backlog");
    expect(harness.reservationRpc).not.toHaveBeenCalled();
    expect(harness.createToken).not.toHaveBeenCalled();
    expect(harness.createBranch).not.toHaveBeenCalled();
    expect(harness.updateFile).not.toHaveBeenCalled();
    expect(harness.createDraftPullRequest).not.toHaveBeenCalled();
  });

  it("rejects an administrator even with the exact confirmation", async () => {
    harness.prepare.mockResolvedValue(preparedContext("admin"));
    const response = await POST(
      createRequest(requestBody({
        confirmation,
        reason: "Update the reviewed backlog priorities for this release.",
        rollbackPlan: "Close the draft pull request without merging if review fails.",
      })),
      { params: Promise.resolve({ owner: "example", repo: "application" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "organization_owner_required" },
    });
    expect(harness.reservationRpc).not.toHaveBeenCalled();
    expect(harness.createToken).not.toHaveBeenCalled();
    expect(harness.createBranch).not.toHaveBeenCalled();
  });

  it("records the exact owner approval before creating only an isolated draft", async () => {
    const protectedApproval = {
      confirmation,
      reason: "Update the reviewed backlog priorities for this release.",
      rollbackPlan: "Close the draft pull request without merging if review fails.",
    };
    const response = await POST(
      createRequest(requestBody(protectedApproval)),
      { params: Promise.resolve({ owner: "example", repo: "application" }) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      pullRequest: { draft: true, number: 21 },
    });
    const digest = createHash("sha256").update("Changed backlog", "utf8").digest("hex");
    expect(harness.reservationRpc).toHaveBeenCalledWith(
      "reserve_owner_approved_protected_github_change",
      expect.objectContaining({
        p_confirmation_text: confirmation,
        p_connection_id: connectionId,
        p_content_sha256: digest,
        p_organization_id: organizationId,
        p_path: path,
        p_project_id: projectId,
        p_rationale: protectedApproval.reason,
        p_repository_id: repositoryId,
        p_rollback_plan: protectedApproval.rollbackPlan,
      }),
    );
    expect(harness.reservationRpc.mock.invocationCallOrder[0]).toBeLessThan(
      harness.createBranch.mock.invocationCallOrder[0]!,
    );
    expect(harness.reservationRpc).toHaveBeenCalledWith("begin_github_change_provider_execution", {
      p_execution_nonce: "60000000-0000-4000-8000-000000000001",
      p_request_id: "80000000-0000-4000-8000-000000000001",
    });
    expect(harness.reservationRpc.mock.invocationCallOrder[1]).toBeLessThan(
      harness.createToken.mock.invocationCallOrder[0]!,
    );
    expect(harness.updateFile).toHaveBeenCalledWith("installation-token", expect.objectContaining({
      branch: expect.stringMatching(/^softwarefactory\//),
      path,
    }));
    expect(harness.createDraftPullRequest).toHaveBeenCalledWith("installation-token", expect.objectContaining({
      baseBranch: "main",
      headBranch: expect.stringMatching(/^softwarefactory\//),
    }));
  });
});
