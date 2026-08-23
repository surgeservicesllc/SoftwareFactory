// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensureProviderBot } from "@/lib/bots/provisioning";

const organizationId = "11111111-2222-4333-8444-555555555555";

/** A client whose bots read returns `existing`, and whose register_bot returns `registered`. */
function fakeClient(options: {
  existing?: unknown[];
  existingError?: unknown;
  missingAiAccountColumn?: boolean;
  registered?: { data: unknown; error: { message?: string; code?: string } | null };
  rpcResults?: Record<string, { data: unknown; error: { message?: string; code?: string } | null }>;
}) {
  const rpc = vi.fn((name: string, _args: Record<string, unknown>) => ({
    single: async () => options.rpcResults?.[name]
      ?? options.registered
      ?? { data: { id: "new-bot" }, error: null },
  }));
  const select = vi.fn((columns: string) => ({
    eq: () => {
      const builder = {
        order: vi.fn(),
        limit: async () => options.missingAiAccountColumn && columns.includes("ai_account_id")
        ? {
            data: null,
            error: { code: "PGRST204", message: "Could not find the 'ai_account_id' column" },
          }
        : { data: options.existing ?? [], error: options.existingError ?? null },
      };
      builder.order.mockReturnValue(builder);
      return builder;
    },
  }));
  const client = {
    from: () => ({
      select,
    }),
    rpc,
  };
  return { client, rpc, select };
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
    const { client, rpc } = fakeClient({ existing: [{ id: "bot-1", provider: "anthropic", name: "Claude" }] });

    const result = await ensureProviderBot(client, organizationId, "anthropic");

    expect(result).toEqual({ outcome: "exists", botId: "bot-1" });
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

  it("provisions against the exact AI account and returns its exact bot id", async () => {
    const { client, rpc } = fakeClient({
      existing: [{ id: "legacy-bot", provider: "anthropic", name: "Claude" }],
      registered: {
        data: { bot_id: "bound-bot", provision_outcome: "bound" },
        error: null,
      },
    });
    const aiAccountId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

    const result = await ensureProviderBot(client, organizationId, "anthropic", {
      aiAccountId,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    });

    expect(result).toEqual({ outcome: "bound", botId: "bound-bot" });
    expect(rpc).toHaveBeenCalledWith("ensure_ai_account_bot", {
      p_organization_id: organizationId,
      p_ai_account_id: aiAccountId,
      p_provider: "anthropic",
      p_name: "Claude 2",
      p_model: "claude-opus-5",
      p_additional: false,
      p_base_url: null,
      p_notes: "Created automatically when this provider was connected.",
    });
  });

  it("returns an existing exact account bot id without guessing from the roster", async () => {
    const { client } = fakeClient({
      existing: [{ id: "some-provider-bot", provider: "anthropic", name: "Claude" }],
      registered: {
        data: { bot_id: "exact-account-bot", provision_outcome: "exists" },
        error: null,
      },
    });

    expect(await ensureProviderBot(client, organizationId, "anthropic", {
      aiAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    })).toEqual({ outcome: "exists", botId: "exact-account-bot" });
  });

  it("never guesses that an unbound credential-slot bot belongs to an account id", async () => {
    const aiAccountId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const { client, rpc } = fakeClient({
      existing: [{
        id: "legacy-bot",
        provider: "anthropic",
        name: "Claude",
        credential_ref: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
        ai_account_id: null,
      }],
      rpcResults: {
        ensure_ai_account_bot: {
          data: null,
          error: { code: "PGRST202", message: "ensure_ai_account_bot is missing" },
        },
      },
    });

    expect(await ensureProviderBot(client, organizationId, "anthropic", {
      aiAccountId,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    })).toMatchObject({ outcome: "skipped", reason: expect.stringMatching(/account-binding/i) });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("register_bot", expect.any(Object));
  });

  it("never registers an unbound bot for an account id when the binding schema is absent", async () => {
    const { client, rpc, select } = fakeClient({
      existing: [],
      missingAiAccountColumn: true,
      rpcResults: {
        ensure_ai_account_bot: {
          data: null,
          error: { code: "PGRST202", message: "ensure_ai_account_bot is missing" },
        },
        register_bot: { data: { id: "legacy-created" }, error: null },
      },
    });

    expect(await ensureProviderBot(client, organizationId, "anthropic", {
      aiAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    })).toMatchObject({ outcome: "skipped", reason: expect.stringMatching(/account-binding/i) });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("register_bot", expect.any(Object));
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("does not create or reuse for a random or cross-tenant account id", async () => {
    const { client, rpc } = fakeClient({
      existing: [{
        id: "other-account-bot",
        provider: "anthropic",
        name: "Claude",
        credential_ref: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
        ai_account_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      }],
      rpcResults: {
        ensure_ai_account_bot: {
          data: null,
          error: { code: "PGRST202", message: "ensure_ai_account_bot is missing" },
        },
      },
    });

    expect(await ensureProviderBot(client, organizationId, "anthropic", {
      aiAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    })).toMatchObject({ outcome: "skipped", reason: expect.stringMatching(/account-binding/i) });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("register_bot", expect.any(Object));
  });

  it("deterministically reuses the oldest exact-bound row without registering a stray bot", async () => {
    const aiAccountId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const { client, rpc } = fakeClient({
      existing: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          provider: "anthropic",
          name: "Claude 3",
          ai_account_id: aiAccountId,
          created_at: "2026-08-22T02:00:00.000Z",
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          provider: "anthropic",
          name: "Claude 2",
          ai_account_id: aiAccountId,
          created_at: "2026-08-22T01:00:00.000Z",
        },
      ],
      rpcResults: {
        ensure_ai_account_bot: {
          data: null,
          error: { code: "PGRST202", message: "ensure_ai_account_bot is missing" },
        },
      },
    });

    expect(await ensureProviderBot(client, organizationId, "anthropic", {
      aiAccountId,
    })).toEqual({
      outcome: "exists",
      botId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("register_bot", expect.any(Object));
  });

  it("does not create ambiguous additional unbound account bots during rollout", async () => {
    const { client, rpc } = fakeClient({
      existing: [],
      rpcResults: {
        ensure_ai_account_bot: {
          data: null,
          error: { code: "PGRST202", message: "ensure_ai_account_bot is missing" },
        },
      },
    });

    const result = await ensureProviderBot(client, organizationId, "anthropic", {
      aiAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
      additional: true,
    });

    expect(result).toMatchObject({ outcome: "skipped" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("never falls back when the account-binding RPC exists but refuses", async () => {
    const { client, rpc } = fakeClient({
      existing: [],
      rpcResults: {
        ensure_ai_account_bot: {
          data: null,
          error: { code: "42501", message: "permission denied" },
        },
      },
    });

    expect((await ensureProviderBot(client, organizationId, "anthropic", {
      aiAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    })).outcome).toBe("skipped");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("adds a numbered further bot when asked, so many can be connected at once", async () => {
    const { client, rpc } = fakeClient({
      existing: [
        { id: "bot-1", provider: "anthropic", name: "Claude" },
        { id: "bot-2", provider: "anthropic", name: "Claude 2" },
      ],
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

  it("names around any taken name, not a predicted count", async () => {
    /*
     * Names are unique per organization; the count was per provider. A
     * cross-provider squat on "Claude", or a numbered survivor after a
     * deletion, made the predicted name collide — a 23505 the console
     * swallowed into zero bots with no sentence.
     */
    const { client, rpc } = fakeClient({
      existing: [
        { id: "bot-1", provider: "openai", name: "Claude" },
        { id: "bot-2", provider: "openai", name: "Claude 2" },
      ],
    });

    const result = await ensureProviderBot(client, organizationId, "anthropic");

    expect(result).toEqual({ outcome: "created", botId: "new-bot" });
    expect(rpc.mock.calls[0]![1] as unknown as Record<string, unknown>).toMatchObject({
      p_name: "Claude 3",
    });
  });

  it("carries the database's vetted sentence in a refusal's reason", async () => {
    const { client } = fakeClient({
      existing: [],
      registered: {
        data: null,
        error: { code: "42501", message: "owner or admin role is required" },
      },
    });

    const result = await ensureProviderBot(client, organizationId, "anthropic");
    expect(result.outcome).toBe("skipped");
    expect(result.outcome === "skipped" ? result.reason : "").toBe(
      "The bot could not be created: owner or admin role is required.",
    );
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
