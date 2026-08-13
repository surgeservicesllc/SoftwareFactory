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

    await user.click(screen.getByRole("button", { name: "Propose change" }));
    expect(await screen.findByText("The network response was lost")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Propose change" }));
    expect(await screen.findByRole("link", { name: /Open PR #12/ })).toBeInTheDocument();

    const saveBodies = fetchMock.mock.calls
      .filter(([input, init]) => String(input).includes("/changes?") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as { idempotencyKey: string });
    expect(saveBodies).toHaveLength(2);
    expect(saveBodies[0]?.idempotencyKey).toBe(saveBodies[1]?.idempotencyKey);
    expect(saveBodies[0]?.idempotencyKey).toBe(`sf:${projectId}:33333333-3333-4333-8333-333333333333`);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit RED owner form and preserves the intent key through approval and retry", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const connectionId = "22222222-2222-4222-8222-222222222222";
    const fileSha = "a".repeat(40);
    const path = "AI/BACKLOG.md";
    const requiredConfirmation = `APPROVE RED DRAFT PR FOR ${path}`;
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("44444444-4444-4444-8444-444444444444");
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
        return jsonResponse({ entries: [{ name: "BACKLOG.md", path, type: "file", sha: fileSha, size: 8, url: `https://github.com/example-org/application/blob/main/${path}` }] });
      }
      if (url.includes("/contents?")) {
        return jsonResponse({ file: { path, sha: fileSha, size: 8, encoding: "utf-8", content: "Original", url: `https://github.com/example-org/application/blob/main/${path}`, ref: "main" } });
      }
      if (url.includes("/commits?")) return jsonResponse({ commits: [] });
      if (url.includes("/changes?") && init?.method === "POST") {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          return jsonResponse({
            error: {
              code: "protected_resource_approval_required",
              path,
              requiredConfirmation,
              risk: "RED",
            },
          }, 428);
        }
        if (saveAttempts === 2) throw new TypeError("The network response was lost");
        return jsonResponse({ pullRequest: { number: 13, title: `Update ${path} via SoftwareFactory`, url: "https://github.com/example-org/application/pull/13", draft: true, state: "open" } }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<GitHubFileManager />);

    await user.click(await screen.findByRole("button", { name: /BACKLOG\.md/ }));
    fireEvent.change(await screen.findByLabelText(`Edit ${path}`), { target: { value: "Changed" } });
    await user.click(screen.getByRole("button", { name: "Propose change" }));

    expect(await screen.findByText(requiredConfirmation)).toBeInTheDocument();
    expect(screen.getByText(/does not write the default branch, merge, or deploy/i)).toBeInTheDocument();
    expect(saveAttempts).toBe(1);
    expect(screen.queryByRole("link", { name: /Open PR/ })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Protected change confirmation"), requiredConfirmation);
    await user.type(screen.getByLabelText("Protected change reason"), "Update the reviewed backlog priorities for this release.");
    await user.type(screen.getByLabelText("Protected change rollback or containment plan"), "Close the draft pull request without merging if review fails.");
    await user.click(screen.getByRole("button", { name: "Approve RED draft PR" }));
    expect(await screen.findByText("The network response was lost")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve RED draft PR" }));
    expect(await screen.findByRole("link", { name: /Open PR #13/ })).toBeInTheDocument();

    const saveBodies = fetchMock.mock.calls
      .filter(([input, init]) => String(input).includes("/changes?") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as {
        idempotencyKey: string;
        protectedApproval?: ProtectedApprovalInput;
      });
    expect(saveBodies).toHaveLength(3);
    expect(new Set(saveBodies.map((body) => body.idempotencyKey))).toEqual(new Set([
      `sf:${projectId}:44444444-4444-4444-8444-444444444444`,
    ]));
    expect(saveBodies[0]?.protectedApproval).toBeUndefined();
    expect(saveBodies[1]?.protectedApproval).toEqual({
      confirmation: requiredConfirmation,
      reason: "Update the reviewed backlog priorities for this release.",
      rollbackPlan: "Close the draft pull request without merging if review fails.",
    });
    expect(saveBodies[2]?.protectedApproval).toEqual(saveBodies[1]?.protectedApproval);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});

type ProtectedApprovalInput = {
  confirmation: string;
  reason: string;
  rollbackPlan: string;
};
