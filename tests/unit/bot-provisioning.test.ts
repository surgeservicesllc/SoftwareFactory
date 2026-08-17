// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensureProviderBot } from "@/lib/bots/provisioning";

const organizationId = "11111111-2222-4333-8444-555555555555";

/** A client whose bots read returns `existing`, and whose register_bot returns `registered`. */
function fakeClient(options: {
  existing?: unknown[];
  existingError?: unknown;
  registered?: { data: unknown; error: { message?: string } | null };
}) {
  const rpc = vi.fn((..._args: unknown[]) => ({
    single: async () => options.registered ?? { data: { id: "new-bot" }, error: null },
  }));
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: async () => ({ data: options.existing ?? [], error: options.existingError ?? null }),
          }),
        }),
      }),
    }),
    rpc,
  };
  return { client, rpc };
}

describe("ensureProviderBot", () => {
  it("creates a ready default bot for a provider the org has none of", async () => {
    const { client, rpc } = fakeClient({ existing: [] });

    const result = await ensureProviderBot(client, organizationId, "anthropic");

    expect(result).toEqual({ outcome: "created", botId: "new-bot" });
    // Named for the provider, on its first suggested model, referencing the
    // same variable the credential fills — so the vault bridge reads it ready.
    const args = rpc.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(args).toMatchObject({
      p_organization_id: organizationId,
      p_name: "Claude",
      p_provider: "anthropic",
      p_model: "claude-opus-5",
      p_credential_ref: "ANTHROPIC_API_KEY",
      p_base_url: null,
    });
  });

  it("does not create a second bot when one already exists for the provider", async () => {
    const { client, rpc } = fakeClient({ existing: [{ id: "bot-1", provider: "anthropic" }] });

    const result = await ensureProviderBot(client, organizationId, "anthropic");

    expect(result).toEqual({ outcome: "exists" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("references the supplied credential when the connect flow knows better than the default", async () => {
    const { client, rpc } = fakeClient({ existing: [] });

    await ensureProviderBot(client, organizationId, "anthropic", {
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    });

    expect(rpc.mock.calls[0]![1] as unknown as Record<string, unknown>).toMatchObject({
      p_credential_ref: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    });
  });

  it("adds a numbered further bot when asked, so many can be connected at once", async () => {
    const { client, rpc } = fakeClient({
      existing: [{ id: "bot-1", provider: "anthropic" }, { id: "bot-2", provider: "anthropic" }],
    });

    const result = await ensureProviderBot(client, organizationId, "anthropic", {
      additional: true,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    });

    expect(result).toEqual({ outcome: "created", botId: "new-bot" });
    expect(rpc.mock.calls[0]![1] as unknown as Record<string, unknown>).toMatchObject({
      p_name: "Claude 3",
    });
  });

  it("skips a provider that needs an endpoint rather than creating a broken bot", async () => {
    const { client, rpc } = fakeClient({ existing: [] });

    const result = await ensureProviderBot(client, organizationId, "selfhosted");

    expect(result.outcome).toBe("skipped");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports an unknown provider rather than guessing", async () => {
    const { client } = fakeClient({ existing: [] });
    expect((await ensureProviderBot(client, organizationId, "mystery")).outcome).toBe("unsupported");
  });

  it("never throws a connection into failure: a name collision is a soft skip", async () => {
    const { client } = fakeClient({
      existing: [],
      registered: { data: null, error: { message: "duplicate key value" } },
    });

    expect((await ensureProviderBot(client, organizationId, "anthropic")).outcome).toBe("skipped");
  });

  it("swallows a malformed client instead of propagating", async () => {
    // The connection has already succeeded; provisioning must degrade quietly.
    expect((await ensureProviderBot({}, organizationId, "anthropic")).outcome).toBe("skipped");
  });
});
