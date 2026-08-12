// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getGitHubFile, listGitHubTree } from "@/lib/github/repository";

const sha = "a".repeat(40);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function githubFile(content: Uint8Array, overrides: Record<string, unknown> = {}) {
  return {
    content: Buffer.from(content).toString("base64"),
    encoding: "base64",
    html_url: "https://github.com/example/application/blob/main/docs/guide.md",
    name: "guide.md",
    path: "docs/guide.md",
    sha,
    size: content.byteLength,
    type: "file",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GitHub repository reads", () => {
  it("reads and maps a repository directory using bounded GitHub API input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      {
        html_url: "https://github.com/example/application/tree/main/docs/reference",
        name: "reference",
        path: "docs/reference",
        sha,
        size: 0,
        type: "dir",
      },
      {
        html_url: "https://github.com/example/application/blob/main/docs/guide.md",
        name: "guide.md",
        path: "docs/guide.md",
        sha: "b".repeat(40),
        size: 12,
        type: "file",
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listGitHubTree(
      "installation-token",
      "example",
      "application",
      "feature/read-safe",
      "docs",
    )).resolves.toEqual([
      {
        name: "reference",
        path: "docs/reference",
        sha,
        size: 0,
        type: "directory",
        url: "https://github.com/example/application/tree/main/docs/reference",
      },
      {
        name: "guide.md",
        path: "docs/guide.md",
        sha: "b".repeat(40),
        size: 12,
        type: "file",
        url: "https://github.com/example/application/blob/main/docs/guide.md",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.github.com/repos/example/application/contents/docs?ref=feature%2Fread-safe"),
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({ Authorization: "Bearer installation-token" }),
        redirect: "error",
      }),
    );
  });

  it("decodes a supported UTF-8 file and preserves SHA/ref metadata", async () => {
    const bytes = Buffer.from("# Guide\n\nSafe UTF-8: ✓\n", "utf8");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(githubFile(bytes))));

    await expect(getGitHubFile(
      "installation-token",
      "example",
      "application",
      "main",
      "docs/guide.md",
    )).resolves.toEqual({
      content: "# Guide\n\nSafe UTF-8: ✓\n",
      encoding: "utf-8",
      path: "docs/guide.md",
      ref: "main",
      sha,
      size: bytes.byteLength,
      url: "https://github.com/example/application/blob/main/docs/guide.md",
    });
  });

  it.each([
    { bytes: Uint8Array.from([0xc3, 0x28]), label: "invalid UTF-8" },
    { bytes: Buffer.from("text\u0000binary", "utf8"), label: "NUL content" },
  ])("rejects binary file content: $label", async ({ bytes }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(githubFile(bytes))));

    await expect(getGitHubFile(
      "installation-token",
      "example",
      "application",
      "main",
      "docs/guide.md",
    )).rejects.toMatchObject({ code: "github_file_binary", status: 415 });
  });

  it("rejects files larger than the 1 MiB editor boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(githubFile(
      Buffer.from("small", "utf8"),
      { size: 1024 * 1024 + 1 },
    ))));

    await expect(getGitHubFile(
      "installation-token",
      "example",
      "application",
      "main",
      "docs/guide.md",
    )).rejects.toMatchObject({ code: "github_file_too_large", status: 413 });
  });

  it("maps a GitHub read failure to a stable client-safe error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(
      { message: "provider detail must not be forwarded" },
      404,
    )));

    await expect(listGitHubTree(
      "installation-token",
      "example",
      "application",
      "main",
    )).rejects.toMatchObject({
      code: "github_resource_not_found",
      message: "The requested GitHub resource was not found or is not installed.",
      status: 404,
    });
  });
});
