// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const credentialPresenceForOrganization = vi.fn();
vi.mock("@/lib/bots/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/service")>("@/lib/bots/service");
  return { ...actual, credentialPresenceForOrganization };
});

const {
  BOT_READINESS_MIGRATION_PENDING_CODE,
  synchronizeBotReadiness,
} = await import(
  "@/lib/bots/readiness-sync"
);

const organizationId = "11111111-2222-4333-8444-555555555555";
const botId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const actorUserId = "99999999-8888-4777-8666-555555555555";

const botRow = {
  id: botId,
  name: "Claude",
  provider: "anthropic",
  model: "claude-opus-5",
  credential_ref: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
  base_url: null,
  readiness: "not_connected",
  readiness_detail: null,
  last_checked_at: null,
  notes: null,
  ai_account_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  created_at: "2026-08-22T00:00:00.000Z",
  revision: 7,
};

function fakeClient(options: {
  readError?: { code?: string; message?: string };
  recordError?: { code?: string; message?: string };
  missingCheckedColumns?: boolean;
  missingCheckedFunction?: boolean;
  missing?: boolean;
  row?: typeof botRow;
} = {}) {
  const select = vi.fn((columns: string) => {
    const filter = {
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: options.missing ? null : (options.row ?? botRow),
        error: options.missingCheckedColumns && columns.includes("revision")
          ? { code: "PGRST204", message: "Could not find the 'revision' column" }
          : options.readError ?? null,
      })),
    };
    filter.eq.mockReturnValue(filter);
    return filter;
  });
  const single = vi.fn(async () => ({
    data: { ...botRow, readiness: "ready", readiness_detail: "Credential resolves." },
    error: options.missingCheckedFunction
      ? { code: "PGRST202", message: "record_bot_readiness_preserving_disabled is missing" }
      : options.recordError ?? null,
  }));
  const rpc = vi.fn(() => ({ single }));
  const legacySingle = vi.fn(async () => ({
    data: { ...botRow, readiness: "ready", readiness_detail: "Credential resolves." },
    error: options.recordError ?? null,
  }));
  const legacyRpc = vi.fn(() => ({ single: legacySingle }));
  return {
    client: {
      from: vi.fn(() => ({ select })),
      rpc: legacyRpc,
    },
    recorder: { rpc },
    rpc,
    legacyRpc,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("synchronizeBotReadiness", () => {
  it("opens the tenant vault, records the exact verdict, and returns the exact bot", async () => {
    credentialPresenceForOrganization.mockResolvedValue((ref: string | null) => Boolean(ref));
    const { client, recorder, rpc } = fakeClient();

    const result = await synchronizeBotReadiness(
      client,
      organizationId,
      botId,
      actorUserId,
      recorder,
    );

    expect(result).toMatchObject({ id: botId, readiness: "ready", currentReadiness: "ready" });
    expect(rpc).toHaveBeenCalledWith("record_bot_readiness_preserving_disabled", {
      p_organization_id: organizationId,
      p_bot_id: botId,
      p_actor_user_id: actorUserId,
      p_expected_revision: 7,
      p_expected_ai_account_id: botRow.ai_account_id,
      p_expected_provider: "anthropic",
      p_expected_model: "claude-opus-5",
      p_expected_credential_ref: botRow.credential_ref,
      p_expected_base_url: null,
      p_readiness: "ready",
      p_detail: expect.stringMatching(/resolve server-side/i),
    });
  });

  it("returns null rather than recording when the exact tenant bot vanished", async () => {
    const { client, recorder, rpc } = fakeClient({ missing: true });

    await expect(synchronizeBotReadiness(
      client,
      organizationId,
      botId,
      actorUserId,
      recorder,
    )).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("preserves a persisted disabled stop even when the vault credential resolves", async () => {
    credentialPresenceForOrganization.mockResolvedValue(() => true);
    const { client, recorder, rpc } = fakeClient({
      row: {
        ...botRow,
        readiness: "disabled",
        readiness_detail: null,
      },
    });

    const result = await synchronizeBotReadiness(
      client,
      organizationId,
      botId,
      actorUserId,
      recorder,
    );

    expect(result).toMatchObject({
      readiness: "disabled",
      currentReadiness: "disabled",
      credentialPresent: true,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed without the legacy recorder when checked identity columns are absent", async () => {
    credentialPresenceForOrganization.mockResolvedValue(() => true);
    const { client, recorder, rpc, legacyRpc } = fakeClient({ missingCheckedColumns: true });

    await expect(synchronizeBotReadiness(
      client,
      organizationId,
      botId,
      actorUserId,
      recorder,
    )).rejects.toMatchObject({
      stage: "record",
      databaseError: { code: BOT_READINESS_MIGRATION_PENDING_CODE },
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(legacyRpc).not.toHaveBeenCalled();
  });

  it("fails closed when the checked recorder is absent and never calls the legacy recorder", async () => {
    credentialPresenceForOrganization.mockResolvedValue(() => true);
    const { client, recorder, rpc, legacyRpc } = fakeClient({ missingCheckedFunction: true });

    await expect(synchronizeBotReadiness(
      client,
      organizationId,
      botId,
      actorUserId,
      recorder,
    )).rejects.toMatchObject({
      stage: "record",
      databaseError: { code: BOT_READINESS_MIGRATION_PENDING_CODE },
    });

    expect(rpc).toHaveBeenCalledWith(
      "record_bot_readiness_preserving_disabled",
      expect.any(Object),
    );
    expect(legacyRpc).not.toHaveBeenCalled();
  });

  it("cannot overwrite Disabled during rollout when checked identity columns are absent", async () => {
    credentialPresenceForOrganization.mockResolvedValue(() => true);
    const { client, recorder, rpc, legacyRpc } = fakeClient({
      missingCheckedColumns: true,
      row: {
        ...botRow,
        readiness: "disabled",
        readiness_detail: null,
      },
    });

    await expect(synchronizeBotReadiness(
      client,
      organizationId,
      botId,
      actorUserId,
      recorder,
    )).rejects.toMatchObject({
      databaseError: { code: BOT_READINESS_MIGRATION_PENDING_CODE },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(legacyRpc).not.toHaveBeenCalled();
    expect(credentialPresenceForOrganization).not.toHaveBeenCalled();
  });

  it("keeps database read and record failures typed for callers", async () => {
    const read = fakeClient({ readError: { code: "42501", message: "denied" } });
    await expect(synchronizeBotReadiness(
      read.client,
      organizationId,
      botId,
      actorUserId,
      read.recorder,
    ))
      .rejects.toMatchObject({ stage: "read" });

    credentialPresenceForOrganization.mockResolvedValue(() => true);
    const record = fakeClient({ recordError: { code: "55000", message: "refused" } });
    await expect(synchronizeBotReadiness(
      record.client,
      organizationId,
      botId,
      actorUserId,
      record.recorder,
    ))
      .rejects.toMatchObject({ stage: "record" });
    expect(record.legacyRpc).not.toHaveBeenCalled();
  });
});
