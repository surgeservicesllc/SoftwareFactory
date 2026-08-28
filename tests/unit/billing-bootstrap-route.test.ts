// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  bootstrapStripeCatalog: vi.fn(),
}));

vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("@/lib/billing/bootstrap", () => ({
  bootstrapStripeCatalog: harness.bootstrapStripeCatalog,
  WEBHOOK_EVENTS: [],
}));

import { POST } from "@/app/api/billing/bootstrap/route";

/**
 * The one-click setup's authority boundary: the platform's Stripe account is
 * not tenant data, so an organization owner is refused and only the
 * deployment's super administrator (confirmed email on the allowlist) may
 * run it — and only once a secret key exists for it to use.
 */

function request() {
  return new Request("https://factory.example/api/billing/bootstrap", {
    method: "POST",
    headers: new Headers({ Origin: "https://factory.example" }),
  });
}

function signInAs(email: string, confirmed = true) {
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: "org-1", role: "owner" },
    client: {},
    user: { id: "u1", email, email_confirmed_at: confirmed ? "2026-01-01T00:00:00Z" : null },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPER_ADMIN_EMAILS", "root@example.org");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/billing/bootstrap", () => {
  it("refuses a tenant organization owner: the Stripe account is not theirs", async () => {
    signInAs("tenant-owner@example.org");
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(harness.bootstrapStripeCatalog).not.toHaveBeenCalled();
  });

  it("refuses the super admin address while its email is unconfirmed", async () => {
    signInAs("root@example.org", false);
    const response = await POST(request());
    expect(response.status).toBe(403);
  });

  it("tells the super admin to add the secret key first", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    signInAs("root@example.org");
    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("STRIPE_SECRET_KEY");
  });

  it("runs the bootstrap for the confirmed super admin and returns its result", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefgh12345678");
    signInAs("root@example.org");
    harness.bootstrapStripeCatalog.mockResolvedValue({
      prices: [{ lookupKey: "factory_pro_monthly", priceId: "price_1", created: true }],
      webhook: { url: "https://factory.example/api/billing/webhook", created: true, signingSecret: "whsec_once" },
    });

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { webhook: { signingSecret: string } };
    expect(body.webhook.signingSecret).toBe("whsec_once");
    expect(harness.bootstrapStripeCatalog).toHaveBeenCalledWith("https://factory.example");
  });
});
