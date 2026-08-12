import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubFileManager } from "@/components/github-file-manager";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GitHubFileManager", () => {
  it("reuses one idempotency key after an ambiguous save failure", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const connectionId = "22222222-2222-4222-8222-222222222222";
    const fileSha = "a".repeat(40);
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("33333333-3333-4333-8333-333333333333");
    let saveAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/projects") {
        return jsonResponse({
          projects: [{
            connectionId,
            connectionStatus: "connected",
            defaultBranch: "main",
            githubRepository: "example-org/application",
            id: projectId,
            name: "Application",
          }],
        });
      }
      if (url.includes("/tree?")) {
        return jsonResponse({ entries: [{ name: "README.md", path: "README.md", type: "file", sha: fileSha, size: 8, url: "https://github.com/example-org/application/blob/main/README.md" }] });
      }
      if (url.includes("/contents?")) {
        return jsonResponse({ file: { path: "README.md", sha: fileSha, size: 8, encoding: "utf-8", content: "Original", url: "https://github.com/example-org/application/blob/main/README.md", ref: "main" } });
      }
      if (url.includes("/commits?")) return jsonResponse({ commits: [] });
      if (url.includes("/changes?") && init?.method === "POST") {
        saveAttempts += 1;
        if (saveAttempts === 1) throw new TypeError("The network response was lost");
        return jsonResponse({ pullRequest: { number: 12, title: "Update README.md via SoftwareFactory", url: "https://github.com/example-org/application/pull/12", draft: true, state: "open" } }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<GitHubFileManager />);

    await user.click(await screen.findByRole("button", { name: /README\.md/ }));
    const editor = await screen.findByLabelText("Edit README.md");
    fireEvent.change(editor, { target: { value: "Changed" } });

    await user.click(screen.getByRole("button", { name: "Create draft PR" }));
    expect(await screen.findByText("The network response was lost")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create draft PR" }));
    expect(await screen.findByRole("link", { name: /Draft PR #12/ })).toBeInTheDocument();

    const saveBodies = fetchMock.mock.calls
      .filter(([input, init]) => String(input).includes("/changes?") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as { idempotencyKey: string });
    expect(saveBodies).toHaveLength(2);
    expect(saveBodies[0]?.idempotencyKey).toBe(saveBodies[1]?.idempotencyKey);
    expect(saveBodies[0]?.idempotencyKey).toBe(`sf:${projectId}:33333333-3333-4333-8333-333333333333`);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});
