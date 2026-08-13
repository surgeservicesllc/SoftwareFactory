// @vitest-environment node

import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const webhookHarness = vi.hoisted(() => ({
  configurationFailure: null as Error | null,
  configurations: [
    {
      configuration: { appId: 4573846, webhookSecret: "w".repeat(48) },
      slot: "primary" as const,
    },
    {
      configuration: { appId: 5573846, webhookSecret: "d".repeat(48) },
      slot: "candidate" as const,
    },
  ],
  insert: vi.fn(),
  insertError: null as { code: string } | null,
  installationAppId: 4573846,
  installationStatus: "active",
  replay: null as { id: string; payload_sha256: string; status: string } | null,
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/github/config", () => ({
  getGitHubAppConfigurationEntries: () => {
    if (webhookHarness.configurationFailure) throw webhookHarness.configurationFailure;
    return webhookHarness.configurations;
  },
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
    updated_at: "2026-08-12T12:00:00Z",
    visibility: "private",
  },
  sender: { id: 789, login: "octocat" },
});

function signatureFor(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret)
    .update(body)
    .digest("hex")}`;
}

function webhookRequest(body = payload, signatureOverride?: string, eventName = "push") {
  const signature = signatureOverride ?? signatureFor(body, "w".repeat(48));
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
  webhookHarness.configurationFailure = null;
  webhookHarness.insertError = null;
  webhookHarness.installationAppId = 4573846;
  webhookHarness.installationStatus = "active";
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
        select: (columns: string) => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                ...(columns.includes("app_id")
                  ? { app_id: webhookHarness.installationAppId }
                  : {}),
                connection_id: "11111111-1111-4111-8111-111111111111",
                id: "22222222-2222-4222-8222-222222222222",
                organization_id: "33333333-3333-4333-8333-333333333333",
                status: webhookHarness.installationStatus,
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
  it("accepts a primary-signed delivery only for a primary-owned installation", async () => {
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
    expect(webhookHarness.insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        app_id: 4573846,
        app_slot: "primary",
      }),
    }));
  });

  it("accepts a candidate-signed delivery only for a candidate-owned installation", async () => {
    webhookHarness.installationAppId = 5573846;

    const response = await POST(webhookRequest(
      payload,
      signatureFor(payload, "d".repeat(48)),
    ));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      processed: true,
    });
    expect(webhookHarness.insert).toHaveBeenCalledWith(expect.objectContaining({
      installation_id: "22222222-2222-4222-8222-222222222222",
      metadata: expect.objectContaining({
        app_id: 5573846,
        app_slot: "candidate",
        known_installation: true,
      }),
    }));
  });

  it("rejects a valid signature when the matched App does not own the installation", async () => {
    const response = await POST(webhookRequest(
      payload,
      signatureFor(payload, "d".repeat(48)),
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "webhook_app_mismatch",
        message: "GitHub webhook App does not match the installation.",
      },
    });
    expect(webhookHarness.insert).not.toHaveBeenCalled();
    expect(webhookHarness.rpc).not.toHaveBeenCalled();
  });

  it("fails closed before database access when dual-App configuration is invalid", async () => {
    webhookHarness.configurationFailure = new Error(
      "GITHUB_CANDIDATE_APP_SLUG is not configured.",
    );

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(webhookHarness.from).not.toHaveBeenCalled();
    expect(webhookHarness.insert).not.toHaveBeenCalled();
    expect(webhookHarness.rpc).not.toHaveBeenCalled();
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
    updated_at: "2026-08-12T12:00:00Z",
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
      installation: { ...installation, updated_at: "2026-08-12T12:00:00Z" },
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

  it("does not reconcile a retried repository grant for a terminal deleted installation", async () => {
    const body = JSON.stringify(validAcceptedPayloads.installation_repositories);
    webhookHarness.installationStatus = "deleted";
    webhookHarness.insertError = { code: "23505" };
    webhookHarness.replay = {
      id: "44444444-4444-4444-8444-444444444444",
      payload_sha256: sha256Hex(new TextEncoder().encode(body)),
      status: "accepted",
    };

    const response = await POST(webhookRequest(body, undefined, "installation_repositories"));

    expect(response.status).toBe(200);
    expect(webhookHarness.rpc).toHaveBeenCalledTimes(1);
    expect(webhookHarness.rpc).toHaveBeenCalledWith("process_github_webhook_delivery", {
      p_delivery_id: "44444444-4444-4444-8444-444444444444",
    });
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

  it("retains only bounded pull-request activity details and its sender", async () => {
    const body = JSON.stringify({
      ...validAcceptedPayloads.pull_request,
      arbitrary_provider_blob: "must-not-be-retained",
      pull_request: {
        ...validAcceptedPayloads.pull_request.pull_request,
        body: "private issue context",
        head: { repo: { clone_url: "https://credential.example/private" } },
      },
      sender: { id: 789, login: "octocat", site_admin: true },
    });

    const response = await POST(webhookRequest(body, undefined, "pull_request"));

    expect(response.status).toBe(202);
    const inserted = webhookHarness.insert.mock.calls[0]?.[0] as {
      payload: Record<string, unknown>;
    };
    expect(inserted.payload).toMatchObject({
      action: "opened",
      pull_request: {
        draft: true,
        id: 1003,
        number: 42,
        state: "open",
      },
      sender: { id: 789, login: "octocat" },
    });
    expect(JSON.stringify(inserted.payload)).not.toMatch(
      /arbitrary_provider_blob|private issue context|clone_url|credential\.example|html_url|site_admin/,
    );
  });

  it.each([
    ["check_run", "check_run", 1001],
    ["check_suite", "check_suite", 1002],
    ["workflow_run", "workflow_run", 1004],
  ] as const)(
    "retains only bounded %s status evidence",
    async (eventName, resourceKey, resourceId) => {
      const eventPayload = validAcceptedPayloads[eventName];
      const resource = (eventPayload as unknown as Record<string, Record<string, unknown>>)[
        resourceKey
      ];
      const body = JSON.stringify({
        ...eventPayload,
        [resourceKey]: {
          ...resource,
          output: { text: "private logs" },
        },
        sender: { id: 789, login: "octocat" },
      });

      const response = await POST(webhookRequest(body, undefined, eventName));

      expect(response.status).toBe(202);
      const inserted = webhookHarness.insert.mock.calls[0]?.[0] as {
        payload: Record<string, Record<string, unknown>>;
      };
      expect(inserted.payload[resourceKey]).toEqual({
        conclusion: "success",
        id: resourceId,
        status: "completed",
      });
      expect(JSON.stringify(inserted.payload)).not.toContain("private logs");
    },
  );

  it("rejects unrecognized check states instead of persisting arbitrary values", async () => {
    const body = JSON.stringify({
      ...validAcceptedPayloads.check_run,
      check_run: {
        conclusion: "secret_value",
        id: 1001,
        status: "private_state",
      },
    });

    const response = await POST(webhookRequest(body, undefined, "check_run"));

    expect(response.status).toBe(400);
    expect(webhookHarness.from).not.toHaveBeenCalled();
  });

  it("records a delayed event for a deleted installation as ignored", async () => {
    webhookHarness.installationStatus = "deleted";
    const body = JSON.stringify({
      action: "unsuspend",
      installation: { id: 456, updated_at: "2026-08-12T12:01:00Z" },
    });

    const response = await POST(webhookRequest(body, undefined, "installation"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ accepted: false, processed: false });
    expect(webhookHarness.rpc).not.toHaveBeenCalled();
    expect(webhookHarness.insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        app_id: 4573846,
        app_slot: "primary",
        accepted_event: true,
        known_installation: true,
        terminal_installation: true,
      }),
      payload: expect.objectContaining({
        installation_updated_at: "2026-08-12T12:01:00Z",
      }),
      status: "ignored",
    }));
  });

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
      metadata: expect.objectContaining({
        app_id: 4573846,
        app_slot: "primary",
        accepted_event: false,
        known_installation: false,
        terminal_installation: false,
      }),
      status: "ignored",
    }));
    expect(JSON.stringify(webhookHarness.insert.mock.calls[0]?.[0]))
      .not.toContain("must-not-be-retained");
  });
});
