// @vitest-environment node

import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const webhookHarness = vi.hoisted(() => ({
  insert: vi.fn(),
  insertError: null as { code: string } | null,
  replay: null as { id: string; payload_sha256: string; status: string } | null,
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/github/config", () => ({
  getGitHubAppConfiguration: () => ({ webhookSecret: "w".repeat(48) }),
}));
vi.mock("@/lib/github/errors", () => ({
  githubRouteErrorResponse: () => Response.json(
    { error: { code: "internal_error", message: "The GitHub request failed safely." } },
    { status: 500 },
  ),
}));
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => ({
    from: webhookHarness.from,
    rpc: webhookHarness.rpc,
  }),
}));

import { POST } from "@/app/api/github/webhooks/route";
import { sha256Hex } from "@/lib/github/webhook";

const payload = JSON.stringify({
  after: "a".repeat(40),
  installation: { id: 456 },
  ref: "refs/heads/main",
  repository: {
    archived: false,
    default_branch: "main",
    disabled: false,
    full_name: "acme/factory",
    id: 123,
    name: "factory",
    owner: { login: "acme" },
    visibility: "private",
  },
  sender: { id: 789, login: "octocat" },
});

function webhookRequest(body = payload, signatureOverride?: string, eventName = "push") {
  const signature = signatureOverride ?? `sha256=${createHmac("sha256", "w".repeat(48))
    .update(body)
    .digest("hex")}`;
  return new Request("https://factory.example/api/github/webhooks", {
    body,
    headers: {
      "content-type": "application/json",
      "x-github-delivery": "delivery-00000001",
      "x-github-event": eventName,
      "x-hub-signature-256": signature,
    },
    method: "POST",
  });
}

beforeEach(() => {
  webhookHarness.insertError = null;
  webhookHarness.replay = null;
  webhookHarness.insert.mockReset().mockImplementation(() => ({
    select: () => ({
      single: async () => ({
        data: webhookHarness.insertError
          ? null
          : { id: "44444444-4444-4444-8444-444444444444", status: "accepted" },
        error: webhookHarness.insertError,
      }),
    }),
  }));
  webhookHarness.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  webhookHarness.from.mockReset().mockImplementation((table: string) => {
    if (table === "github_installations") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                connection_id: "11111111-1111-4111-8111-111111111111",
                id: "22222222-2222-4222-8222-222222222222",
                organization_id: "33333333-3333-4333-8333-333333333333",
              },
              error: null,
            }),
          }),
        }),
      };
    }

    return {
      insert: webhookHarness.insert,
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: webhookHarness.replay, error: null }),
        }),
      }),
    };
  });
});

describe("GitHub webhook route", () => {
  it("verifies, records, and synchronously processes a valid delivery", async () => {
    const response = await POST(webhookRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      deliveryId: "delivery-00000001",
      duplicate: false,
      processed: true,
      queued: false,
    });
    expect(webhookHarness.from).toHaveBeenCalledWith("github_installations");
    expect(webhookHarness.from).toHaveBeenCalledWith("github_webhook_deliveries");
    expect(webhookHarness.rpc).toHaveBeenCalledWith("process_github_webhook_delivery", {
      p_delivery_id: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("rejects an invalid signature before any database access", async () => {
    const response = await POST(webhookRequest(payload, `sha256=${"0".repeat(64)}`));

    expect(response.status).toBe(401);
    expect(webhookHarness.from).not.toHaveBeenCalled();
    expect(webhookHarness.rpc).not.toHaveBeenCalled();
  });

  it("treats an identical, already-processed delivery as idempotent", async () => {
    webhookHarness.insertError = { code: "23505" };
    webhookHarness.replay = {
      id: "44444444-4444-4444-8444-444444444444",
      payload_sha256: sha256Hex(new TextEncoder().encode(payload)),
      status: "processed",
    };

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
      processed: true,
    });
    expect(webhookHarness.rpc).not.toHaveBeenCalled();
  });

  const repository = {
    full_name: "acme/factory",
    id: 123,
  };
  const installation = { id: 456 };
  const validAcceptedPayloads = {
    check_run: {
      action: "completed",
      check_run: { conclusion: "success", id: 1001, status: "completed" },
      installation,
      repository,
    },
    check_suite: {
      action: "completed",
      check_suite: { conclusion: "success", id: 1002, status: "completed" },
      installation,
      repository,
    },
    installation: {
      action: "created",
      installation,
    },
    installation_repositories: {
      action: "added",
      installation,
      repositories_added: [{
        archived: false,
        default_branch: "main",
        disabled: false,
        full_name: "acme/factory",
        html_url: "https://github.com/acme/factory",
        id: 123,
        name: "factory",
        owner: { login: "acme" },
        private: true,
        updated_at: "2026-08-12T12:00:00Z",
        visibility: "private",
      }],
      repositories_removed: [],
    },
    pull_request: {
      action: "opened",
      installation,
      pull_request: {
        draft: true,
        html_url: "https://github.com/acme/factory/pull/42",
        id: 1003,
        number: 42,
        state: "open",
      },
      repository,
    },
    push: {
      after: "a".repeat(40),
      installation,
      ref: "refs/heads/main",
      repository,
    },
    repository: {
      action: "edited",
      installation,
      repository,
    },
    status: {
      installation,
      repository,
      sha: "a".repeat(40),
      state: "success",
    },
    workflow_run: {
      action: "completed",
      installation,
      repository,
      workflow_run: { conclusion: "success", id: 1004, status: "completed" },
    },
  } as const;

  it("reconciles an identical pending repository-grant delivery only after deduplication", async () => {
    const body = JSON.stringify(validAcceptedPayloads.installation_repositories);
    webhookHarness.insertError = { code: "23505" };
    webhookHarness.replay = {
      id: "44444444-4444-4444-8444-444444444444",
      payload_sha256: sha256Hex(new TextEncoder().encode(body)),
      status: "accepted",
    };

    const response = await POST(webhookRequest(body, undefined, "installation_repositories"));

    expect(response.status).toBe(200);
    expect(webhookHarness.rpc).toHaveBeenNthCalledWith(1, "reconcile_github_repository_grants", expect.objectContaining({
      p_installation_id: "22222222-2222-4222-8222-222222222222",
      p_organization_id: "33333333-3333-4333-8333-333333333333",
    }));
    expect(webhookHarness.rpc).toHaveBeenNthCalledWith(2, "process_github_webhook_delivery", {
      p_delivery_id: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("does not reconcile a conflicting repository-grant delivery id", async () => {
    const body = JSON.stringify(validAcceptedPayloads.installation_repositories);
    webhookHarness.insertError = { code: "23505" };
    webhookHarness.replay = {
      id: "44444444-4444-4444-8444-444444444444",
      payload_sha256: "f".repeat(64),
      status: "accepted",
    };

    const response = await POST(webhookRequest(body, undefined, "installation_repositories"));

    expect(response.status).toBe(409);
    expect(webhookHarness.rpc).not.toHaveBeenCalled();
  });

  it.each(Object.entries(validAcceptedPayloads))(
    "accepts a minimally valid %s payload",
    async (eventName, eventPayload) => {
      const response = await POST(webhookRequest(JSON.stringify(eventPayload), undefined, eventName));

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({ accepted: true, processed: true });
      expect(webhookHarness.rpc).toHaveBeenCalledTimes(eventName === "installation_repositories" ? 2 : 1);
    },
  );

  it.each(Object.entries(validAcceptedPayloads))(
    "rejects a %s payload without its GitHub App installation before database access",
    async (eventName, eventPayload) => {
      const withoutInstallation: Record<string, unknown> = { ...eventPayload };
      delete withoutInstallation.installation;
      const response = await POST(webhookRequest(
        JSON.stringify(withoutInstallation),
        undefined,
        eventName,
      ));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_webhook_payload" },
      });
      expect(webhookHarness.from).not.toHaveBeenCalled();
      expect(webhookHarness.rpc).not.toHaveBeenCalled();
    },
  );

  it("rejects a signed accepted event whose payload belongs to another event", async () => {
    const response = await POST(webhookRequest(payload, undefined, "pull_request"));

    expect(response.status).toBe(400);
    expect(webhookHarness.from).not.toHaveBeenCalled();
    expect(webhookHarness.rpc).not.toHaveBeenCalled();
  });

  it("records an unknown signed event as ignored without retaining arbitrary payload fields", async () => {
    const unknownPayload = JSON.stringify({
      installation: { id: 456 },
      secret_like_provider_field: "must-not-be-retained",
    });
    const response = await POST(webhookRequest(unknownPayload, undefined, "ping"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ accepted: false, processed: false });
    expect(webhookHarness.rpc).not.toHaveBeenCalled();
    expect(webhookHarness.insert).toHaveBeenCalledWith(expect.objectContaining({
      external_installation_id: null,
      metadata: { accepted_event: false, known_installation: false },
      status: "ignored",
    }));
    expect(JSON.stringify(webhookHarness.insert.mock.calls[0]?.[0]))
      .not.toContain("must-not-be-retained");
  });
});
