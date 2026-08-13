// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  listPullRequests: vi.fn(),
  prepareRepositoryRequest: vi.fn(),
}));

vi.mock("@/lib/github/repository", () => ({
  listGitHubPullRequests: harness.listPullRequests,
}));
vi.mock("@/lib/github/route", () => ({
  prepareGitHubRepositoryRequest: harness.prepareRepositoryRequest,
}));

import { GET } from "@/app/api/github/repositories/[owner]/[repo]/pulls/route";

beforeEach(() => {
  vi.clearAllMocks();
  harness.prepareRepositoryRequest.mockResolvedValue({
    owner: "example",
    repository: "repository",
    token: "installation-token",
  });
  harness.listPullRequests.mockResolvedValue([]);
});

describe("GitHub pull-request route permissions", () => {
  it("requests only pull-request read permission", async () => {
    const request = new Request(
      "https://factory.example/api/github/repositories/example/repository/pulls",
    );
    const coordinates = { owner: "example", repo: "repository" };

    const response = await GET(request, { params: Promise.resolve(coordinates) });

    expect(response.status).toBe(200);
    expect(harness.prepareRepositoryRequest).toHaveBeenCalledWith(
      request,
      coordinates,
      { pull_requests: "read" },
    );
    expect(harness.listPullRequests).toHaveBeenCalledWith(
      "installation-token",
      "example",
      "repository",
      { includeMergeability: false },
    );
  });

  it("loads bounded mergeability details only when requested by the inspector", async () => {
    const request = new Request(
      "https://factory.example/api/github/repositories/example/repository/pulls?includeMergeability=true",
    );

    const response = await GET(request, {
      params: Promise.resolve({ owner: "example", repo: "repository" }),
    });

    expect(response.status).toBe(200);
    expect(harness.listPullRequests).toHaveBeenCalledWith(
      "installation-token",
      "example",
      "repository",
      { includeMergeability: true },
    );
  });
});
