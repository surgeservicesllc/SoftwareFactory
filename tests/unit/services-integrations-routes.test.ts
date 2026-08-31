// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { GET as listIntegrations, PUT as saveIntegration } from "@/app/api/services/integrations/route";
import { integrationStanding, toIntegrationStatusView } from "@/lib/services/crm";

/**
 * The integrations boundary.
 *
 * The behavior suite proves the database will not call a provider live
 * without a sealed credential. This file pins what the ROUTE must not
 * undo: it must never compose a status of its own, never accept one from a
 * caller, and never let a credential reach a metadata column.
 */

const organizationId = "10000000-0000-4000-8000-00000010a001";
const userId = "00000000-0000-4000-8000-00000010a001";

let rpc: ReturnType<typeof vi.fn>;
let upsert: ReturnType<typeof vi.fn>;

function statusRow(overrides: Record<string, unknown> = {}) {
  return {
    provider: "sms",
    configured: false,
    enabled: false,
    credential_present: false,
    live: false,
    display_label: null,
    last_checked_at: null,
    last_error: null,
    ...overrides,
  };
}

function client(options: { status?: unknown[]; upsertError?: unknown } = {}) {
  rpc = vi.fn(() => Promise.resolve({ data: options.status ?? [], error: null }));
  upsert = vi.fn(() => Promise.resolve({ error: options.upsertError ?? null }));
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { rpc, from: vi.fn(() => ({ upsert })) },
  });
}

function put(body: unknown) {
  return new Request("https://factory.example/api/services/integrations", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the integrations route", () => {
  it("reports a provider that is switched on but has no credential as not live", async () => {
    client({
      status: [statusRow({ configured: true, enabled: true, credential_present: false, live: false })],
    });
    const body = (await (await listIntegrations()).json()) as {
      providers: { live: boolean; standing: string; gates: string }[];
      counts: Record<string, number>;
    };

    // Enabled is an intention. Live is a capability. The route must not
    // blur them on the way out.
    expect(body.providers[0].live).toBe(false);
    expect(body.providers[0].standing).toBe("awaiting_credential");
    expect(body.counts.live).toBe(0);
    expect(body.counts.awaitingCredential).toBe(1);
    // And the label says what is actually being given up.
    expect(body.providers[0].gates).toMatch(/reminders/i);
  });

  it("separates switched-off from waiting-on-an-account, because the next step differs", async () => {
    client({
      status: [
        statusRow({ provider: "sms", configured: true, enabled: false, credential_present: true }),
        statusRow({ provider: "email", configured: true, enabled: true, credential_present: false }),
        statusRow({ provider: "mapping", configured: false }),
      ],
    });
    const body = (await (await listIntegrations()).json()) as { counts: Record<string, number> };

    expect(body.counts.paused).toBe(1);
    expect(body.counts.awaitingCredential).toBe(1);
    expect(body.counts.notConfigured).toBe(1);
    expect(body.counts.live).toBe(0);
  });

  it("calls a live provider with a recorded error failing, not connected", async () => {
    client({
      status: [
        statusRow({
          configured: true, enabled: true, credential_present: true, live: true,
          last_error: "the provider rejected the sender id",
        }),
      ],
    });
    const body = (await (await listIntegrations()).json()) as {
      providers: { standing: string }[];
      counts: Record<string, number>;
    };
    // A credential that exists and a provider that is refusing us are not
    // the same as working, and an operator needs to see the difference.
    expect(body.providers[0].standing).toBe("failing");
    expect(body.counts.failing).toBe(1);
  });

  it("takes no status from the caller, and re-reads rather than echoing the write", async () => {
    client({ status: [statusRow({ configured: true, enabled: true })] });
    const refused = await saveIntegration(
      put({
        provider: "sms",
        credentialPurpose: "crm_sms_provider",
        enabled: true,
        // A caller trying to assert the outcome directly.
        live: true,
      }),
    );
    expect(refused.status).toBe(422);
    expect(upsert).not.toHaveBeenCalled();

    client({ status: [statusRow({ configured: true, enabled: true })] });
    const saved = await saveIntegration(
      put({ provider: "sms", credentialPurpose: "crm_sms_provider", enabled: true }),
    );
    expect(saved.status).toBe(200);
    // The response comes from a fresh status read, not from the payload
    // the route just wrote — so it cannot report a capability it invented.
    expect(rpc).toHaveBeenCalledWith("crm_integration_status", {
      p_organization_id: organizationId,
    });
    const body = (await saved.json()) as { provider: { live: boolean } };
    expect(body.provider.live).toBe(false);
  });

  it("turns the schema's secret refusal into an answer about where the key went", async () => {
    client({
      upsertError: {
        code: "23514",
        message:
          'new row violates check constraint "crm_service_integrations_settings_no_secret"',
      },
    });
    const response = await saveIntegration(
      put({
        provider: "email",
        credentialPurpose: "crm_email_provider",
        settings: { api_key: `bearer ${"a".repeat(30)}` },
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("credential_in_metadata");
    // The message has to tell them where the credential actually belongs.
    expect(body.error.message).toMatch(/Connect the provider/i);
  });

  it("refuses a purpose name that is not one, before it reaches the database", async () => {
    client();
    // Shape only. A key-shaped name that happens to fit the pattern is
    // caught by the schema's secret guard, which has its own test in the
    // behavior suite — the route cannot tell a name from a token.
    for (const purpose of ["Not A Purpose", "", "9leading", "has-dashes", "UPPER"]) {
      const response = await saveIntegration(
        put({ provider: "sms", credentialPurpose: purpose }),
      );
      expect(response.status).toBe(422);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it("never accepts a credential field anywhere in the request", async () => {
    client();
    for (const extra of [
      { apiKey: "sk_live_x" },
      { credential: "sk_live_x" },
      { sealedEnvelope: "v1.abc" },
    ]) {
      const response = await saveIntegration(
        put({ provider: "sms", credentialPurpose: "crm_sms_provider", ...extra }),
      );
      // The schema is strict(), so an unknown key is refused outright —
      // supplying a credential is the vault's business and there is no
      // door to it here.
      expect(response.status).toBe(422);
    }
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("integrationStanding", () => {
  it("never returns live for anything without a credential", () => {
    const withoutCredential = [
      { configured: false, enabled: false, credentialPresent: false, live: false, lastError: null },
      { configured: true, enabled: true, credentialPresent: false, live: false, lastError: null },
      { configured: true, enabled: false, credentialPresent: false, live: false, lastError: null },
    ];
    for (const status of withoutCredential) {
      expect(integrationStanding(status)).not.toBe("live");
      expect(integrationStanding(status)).not.toBe("failing");
    }
  });

  it("maps the row shape the database returns straight through", () => {
    const view = toIntegrationStatusView({
      provider: "card_payments",
      configured: true,
      enabled: true,
      credential_present: true,
      live: true,
      display_label: "Main merchant account",
      last_checked_at: "2026-08-30T00:00:00Z",
      last_error: null,
    });
    expect(view.live).toBe(true);
    expect(view.credentialPresent).toBe(true);
    expect(integrationStanding(view)).toBe("live");
    expect(view.gates).toMatch(/portal/i);
  });
});
