// @vitest-environment node

import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchGitHubInstallationSnapshot } from "@/lib/github/client";

const installationId = 456;
const configuredEvents = [
  "check_run",
  "check_suite",
  "pull_request",
  "push",
  "repository",
  "status",
  "workflow_run",
];
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const configuration = {
  appId: 987,
  privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
};

function installation(events = configuredEvents) {
  return {
    account: {
      avatar_url: null,
      id: 9001,
      login: "example-org",
      type: "Organization",
    },
    app_id: configuration.appId,
    app_slug: "example-app",
    created_at: "2026-08-12T20:00:00.000Z",
    events,
    id: installationId,
    permissions: {
      actions: "read",
      checks: "read",
      contents: "write",
      metadata: "read",
      pull_requests: "write",
      statuses: "read",
    },
    repository_selection: "selected",
    suspended_at: null,
    target_type: "Organization",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub App installation event validation", () => {
  it("accepts all configured subscriptions when automatic lifecycle events are absent", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === `/app/installations/${installationId}`) {
        return Response.json(installation());
      }
      if (path === `/app/installations/${installationId}/access_tokens`) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ permissions: { metadata: "read" } });
        return Response.json({
          expires_at: "2026-08-12T21:00:00.000Z",
          token: "installation-token-placeholder-value",
        });
      }
      if (path === "/installation/repositories") {
        return Response.json({ repositories: [], total_count: 0 });
      }
      throw new Error(`Unexpected GitHub request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchGitHubInstallationSnapshot(configuration, installationId);

    expect(snapshot.events).toEqual(configuredEvents);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("still rejects a missing configurable webhook subscription", async () => {
    const fetchMock = vi.fn(async () => Response.json(
      installation(configuredEvents.filter((event) => event !== "workflow_run")),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGitHubInstallationSnapshot(configuration, installationId))
      .rejects.toMatchObject({ code: "github_permission_denied", status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
