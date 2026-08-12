// @vitest-environment node

import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const webhookHarness = vi.hoisted(() => ({
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

function webhookRequest(body = payload, signatureOverride?: string) {
  const signature = signatureOverride ?? `sha256=${createHmac("sha256", "w".repeat(48))
    .update(body)
    .digest("hex")}`;
  return new Request("https://factory.example/api/github/webhooks", {
    body,
    headers: {
      "content-type": "application/json",
      "x-github-delivery": "delivery-00000001",
      "x-github-event": "push",
      "x-hub-signature-256": signature,
    },
    method: "POST",
  });
}

beforeEach(() => {
  webhookHarness.insertError = null;
  webhookHarness.replay = null;
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
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: webhookHarness.insertError
              ? null
              : { id: "44444444-4444-4444-8444-444444444444", status: "accepted" },
            error: webhookHarness.insertError,
          }),
        }),
      }),
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
});
