// @vitest-environment node

import { randomBytes } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

process.env.SOFTWAREFACTORY_CREDENTIAL_KEY = randomBytes(32).toString("base64");

const { relayCodePurpose } = await import("@/lib/ai-accounts/purposes");
const { openSecret, sealSecret } = await import("@/lib/security/secret-box-core");
const { runAuthBrokerOnce, verifyStoredAccounts } = await import("@/lib/worker/auth-broker");
type AuthBrokerStore = import("@/lib/worker/auth-broker").AuthBrokerStore;
type ClaimedAuthSession = import("@/lib/worker/auth-broker").ClaimedAuthSession;

/**
 * The acceptance journey, end to end against the real migrated schema.
 *
 * This is the BotBuild spec's final journey with exactly one substitution:
 * the provider CLI is played by a script (URL out, token in) because a real
 * `claude setup-token` needs a human at claude.ai. Everything else is the
 * real thing — the real definer functions in the real migration chain, the
 * real worker protocol (`runAuthBrokerOnce`), the real seal in both
 * directions, and the real verification sweep. The person's actions are the
 * same RPCs the routes call.
 *
 * The walk: Connect creates an account and opens a session → the worker
 * claims it and reports the provider's login URL → the person "signs in" and
 * pastes the confirmation code into the app (sealed, session-bound) → the
 * worker collects it, mints the token, seals it into the vault, and the
 * account reads connected with a Ready-able credential → the sweep verifies
 * it → disconnect removes the credential and Reconnect walks again.
 */


const ownerId = "00000000-0000-4000-8000-0000000000c1";
const organizationId = "10000000-0000-4000-8000-0000000000c1";

const LOGIN_URL = "https://claude.com/cai/oauth/authorize?code=true&client_id=journey";
const CONFIRMATION_CODE = "JOURNEY-CODE-4711";
const MINTED_TOKEN = "sk-ant-oat01-journey-minted-token-abcdefghijklmnop";

describe("the AI-account acceptance journey", { timeout: 180_000 }, () => {
  let db: PGlite;

  /** The worker's store, over the same definer functions production calls. */
  function pgliteStore(): AuthBrokerStore {
    return {
      claim: async (workerId) => {
        const { rows } = await db.query<{
          claimed_session_id: string;
          claimed_organization_id: string;
          claimed_account_id: string;
          claimed_provider: string;
          claimed_purpose: string;
        }>("select * from public.claim_ai_auth_session($1)", [workerId]);
        const row = rows[0];
        if (!row) return null;
        return {
          sessionId: row.claimed_session_id,
          organizationId: row.claimed_organization_id,
          accountId: row.claimed_account_id,
          provider: row.claimed_provider,
          purpose: row.claimed_purpose,
        };
      },
      reportLoginUrl: async (sessionId, loginUrl) => {
        const { rows } = await db.query<{ report_ai_auth_login_url: boolean }>(
          "select public.report_ai_auth_login_url($1::uuid, $2)", [sessionId, loginUrl],
        );
        return rows[0].report_ai_auth_login_url;
      },
      readRelayCode: async (sessionId) => {
        const { rows } = await db.query<{ read_ai_auth_relay_code: string | null }>(
          "select public.read_ai_auth_relay_code($1::uuid)", [sessionId],
        );
        return rows[0].read_ai_auth_relay_code;
      },
      markVerifying: async (sessionId) => {
        const { rows } = await db.query<{ mark_ai_auth_session_verifying: boolean }>(
          "select public.mark_ai_auth_session_verifying($1::uuid)", [sessionId],
        );
        return rows[0].mark_ai_auth_session_verifying;
      },
      complete: async (sessionId, sealedEnvelope) => {
        await db.query(
          "select * from public.complete_ai_auth_session($1::uuid, $2)",
          [sessionId, sealedEnvelope],
        );
      },
      fail: async (sessionId, reason) => {
        await db.query(
          "select public.fail_ai_auth_session($1::uuid, $2)", [sessionId, reason],
        );
      },
      expireStale: async () => {
        const { rows } = await db.query<{ expire_ai_auth_sessions: number }>(
          "select public.expire_ai_auth_sessions()",
        );
        return rows[0].expire_ai_auth_sessions;
      },
      listAccountsForVerification: async () => {
        const { rows } = await db.query<{
          verifiable_organization_id: string;
          verifiable_account_id: string;
          verifiable_provider: string;
          verifiable_purpose: string;
        }>("select * from public.list_ai_accounts_for_verification()");
        return rows.map((row) => ({
          organizationId: row.verifiable_organization_id,
          accountId: row.verifiable_account_id,
          provider: row.verifiable_provider,
          purpose: row.verifiable_purpose,
        }));
      },
      readStoredCredential: async (orgId, purpose) => {
        const { rows } = await db.query<{ read_provider_credential: string | null }>(
          "select public.read_provider_credential($1::uuid, $2)", [orgId, purpose],
        );
        return rows[0].read_provider_credential;
      },
      markAccountVerified: async (orgId, accountId) => {
        const { rows } = await db.query<{ mark_ai_account_verified: boolean }>(
          "select public.mark_ai_account_verified($1::uuid, $2::uuid)", [orgId, accountId],
        );
        return rows[0].mark_ai_account_verified;
      },
      markAccountNeedsReauth: async (orgId, accountId, reason) => {
        const { rows } = await db.query<{ mark_ai_account_needs_reauth: boolean }>(
          "select public.mark_ai_account_needs_reauth($1::uuid, $2::uuid, $3)",
          [orgId, accountId, reason],
        );
        return rows[0].mark_ai_account_needs_reauth;
      },
    };
  }

  async function asOwner<T>(work: () => Promise<T>): Promise<T> {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
    await db.exec("set role authenticated");
    try {
      return await work();
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  }

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-journey', '${ownerId}');
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("walks Connect → worker login → code paste → connected bot credential → verified → disconnect → reconnect", async () => {
    const store = pgliteStore();

    // 1. The person clicks Connect: an account exists and a session opens.
    const accountId = await asOwner(async () => {
      const created = await db.query<{ create_ai_account: string }>(
        "select public.create_ai_account($1::uuid, 'anthropic', 'subscription', 'Claude account 1', 'claude')",
        [organizationId],
      );
      return created.rows[0].create_ai_account;
    });
    const sessionId = await asOwner(async () => {
      const opened = await db.query<{ open_ai_auth_session: string }>(
        "select public.open_ai_auth_session($1::uuid, $2::uuid, 900)",
        [organizationId, accountId],
      );
      return opened.rows[0].open_ai_auth_session;
    });

    // 2-5. The worker drives the provider login. The scripted CLI emits the
    // URL, receives the person's code, and mints the token. In parallel (the
    // relay poll), the person sees awaiting_user, opens the URL, and pastes
    // the confirmation code into the app — which seals it bound to exactly
    // this session before storage.
    let codeGivenToCli: string | null = null;
    const outcome = await runAuthBrokerOnce("journey-worker", {
      store,
      startLogin: async () => ({
        waitForLoginUrl: async () => LOGIN_URL,
        submitCode: async (code) => { codeGivenToCli = code; },
        waitForToken: async () => {
          expect(codeGivenToCli).toBe(CONFIRMATION_CODE);
          return MINTED_TOKEN;
        },
        dispose: async () => undefined,
      }),
      openRelayCode: (s, sealed) => openSecret(sealed, {
        organizationId: s.organizationId, purpose: relayCodePurpose(s.sessionId),
      }),
      sealCredential: (s, token) => sealSecret(token, {
        organizationId: s.organizationId, purpose: s.purpose,
      }),
      sleep: async () => {
        // The person's turn happens while the worker polls: confirm the
        // console-visible state, then paste the code as the route would.
        const seen = await asOwner(async () => {
          const { rows } = await db.query<{ status: string; login_url: string }>(
            "select status, login_url from public.read_ai_auth_session($1::uuid, $2::uuid)",
            [organizationId, sessionId],
          );
          return rows[0];
        });
        if (seen.status === "awaiting_user") {
          expect(seen.login_url).toBe(LOGIN_URL);
          const sealed = sealSecret(CONFIRMATION_CODE, {
            organizationId, purpose: relayCodePurpose(sessionId),
          });
          await asOwner(async () => {
            await db.query(
              "select public.attach_ai_auth_relay_code($1::uuid, $2::uuid, $3)",
              [organizationId, sessionId, sealed],
            );
          });
        }
      },
    });
    expect(outcome).toBe("connected");

    // 6. The account is connected and the vault holds the minted credential,
    // sealed under the account's purpose — openable, and exactly the token.
    const { rows: accountRows } = await db.query<{ status: string }>(
      "select status from public.ai_accounts where id = $1", [accountId],
    );
    expect(accountRows[0].status).toBe("connected");
    const sealedCredential = await store.readStoredCredential(organizationId, "claude");
    expect(sealedCredential).not.toBeNull();
    expect(openSecret(sealedCredential!, { organizationId, purpose: "claude" }))
      .toBe(MINTED_TOKEN);

    // 7. The verification sweep confirms the claim it just made.
    const sweep = await verifyStoredAccounts(store);
    expect(sweep).toEqual({ verified: 1, demoted: 0 });

    // 8. Disconnect removes the credential, not the account.
    await asOwner(async () => {
      const { rows } = await db.query<{ disconnect_ai_account: boolean }>(
        "select public.disconnect_ai_account($1::uuid, $2::uuid)",
        [organizationId, accountId],
      );
      expect(rows[0].disconnect_ai_account).toBe(true);
    });
    expect(await store.readStoredCredential(organizationId, "claude")).toBeNull();

    // 9. Reconnect is the same walk against the same account row.
    const secondSession = await asOwner(async () => {
      const opened = await db.query<{ open_ai_auth_session: string }>(
        "select public.open_ai_auth_session($1::uuid, $2::uuid, 900)",
        [organizationId, accountId],
      );
      return opened.rows[0].open_ai_auth_session;
    });
    const reclaimed = await store.claim("journey-worker-2");
    expect(reclaimed?.sessionId).toBe(secondSession);
    expect(reclaimed?.accountId).toBe(accountId);

    // 10. And the whole journey is on the audit trail.
    const { rows: eventRows } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.activity_events
       where organization_id = $1 and event_type = 'ai_account.changed'`,
      [organizationId],
    );
    expect(Number(eventRows[0].count)).toBeGreaterThanOrEqual(8);
  });

  it("keeps two accounts' credentials isolated through the same journey", async () => {
    // A second account on its own slot: the seal binding proves isolation —
    // slot 2's envelope opens only under slot 2's purpose.
    const secondToken = "sk-ant-oat01-second-account-token-qrstuvwxyz012345";
    await asOwner(async () => {
      await db.query(
        "select public.create_ai_account($1::uuid, 'anthropic', 'subscription', 'Claude account 2', 'claude_2')",
        [organizationId],
      );
    });
    const store = pgliteStore();
    // Seed slot 2's credential through the same completion path the worker
    // uses: open, claim, report, relay, complete.
    const accountRow = await db.query<{ id: string }>(
      "select id from public.ai_accounts where credential_purpose = 'claude_2'",
    );
    const accountId = accountRow.rows[0].id;
    const sessionId = await asOwner(async () => {
      const opened = await db.query<{ open_ai_auth_session: string }>(
        "select public.open_ai_auth_session($1::uuid, $2::uuid, 900)",
        [organizationId, accountId],
      );
      return opened.rows[0].open_ai_auth_session;
    });
    const claimed = (await store.claim("journey-worker-3")) as ClaimedAuthSession;
    expect(claimed.purpose).toBe("claude_2");
    await store.reportLoginUrl(sessionId, LOGIN_URL);
    await asOwner(async () => {
      await db.query(
        "select public.attach_ai_auth_relay_code($1::uuid, $2::uuid, $3)",
        [organizationId, sessionId, sealSecret("CODE-2", {
          organizationId, purpose: relayCodePurpose(sessionId),
        })],
      );
    });
    await store.complete(sessionId, sealSecret(secondToken, {
      organizationId, purpose: "claude_2",
    }));

    const slotTwo = await store.readStoredCredential(organizationId, "claude_2");
    expect(openSecret(slotTwo!, { organizationId, purpose: "claude_2" })).toBe(secondToken);
    // The isolation guarantee, exercised: slot 2's envelope refuses to open
    // as slot 1's credential even inside the same organization.
    expect(() => openSecret(slotTwo!, { organizationId, purpose: "claude" })).toThrow();
  });
});
