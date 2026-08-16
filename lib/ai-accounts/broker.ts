import "server-only";

import { findBotProvider } from "@/lib/bots/catalog";

/**
 * The account side of the auth broker: which providers offer broker sign-in,
 * which vault purposes their accounts may occupy, and how a Connect click
 * chooses between reusing an account and creating one.
 *
 * The purposes are deliberately the same six the connect-command flow uses.
 * A credential the broker seals under `claude_2` is immediately visible to
 * the existing readiness bridge and worker overlay — the two paths converge
 * on one vault row rather than growing parallel credential stores.
 */

export const BROKER_PROVIDERS = {
  anthropic: { purposes: ["claude", "claude_2", "claude_3"] as const },
  openai: { purposes: ["codex", "codex_2", "codex_3"] as const },
} as const;

export type BrokerProviderId = keyof typeof BROKER_PROVIDERS;

export function isBrokerProviderId(value: string): value is BrokerProviderId {
  return Object.hasOwn(BROKER_PROVIDERS, value);
}

/** "Claude account 2" — the slot is visible in the name on purpose. */
export function accountDisplayName(providerId: BrokerProviderId, slotIndex: number): string {
  const label = findBotProvider(providerId)?.label ?? providerId;
  return `${label} account ${slotIndex + 1}`;
}

/**
 * The seal context for a session's relayed confirmation code. Bound to the
 * session rather than the account so a code parked for one sign-in can never
 * be opened against another, even on the same account.
 */
export function relayCodePurpose(sessionId: string): string {
  return `ai_auth_relay:${sessionId}`;
}

export type AiAccountRow = {
  account_id: string;
  provider: string;
  auth_method: string;
  display_name: string;
  status: string;
  credential_purpose: string;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export async function listAiAccounts(
  client: RpcClient,
  organizationId: string,
): Promise<AiAccountRow[]> {
  const { data, error } = await client.rpc("list_ai_accounts", {
    p_organization_id: organizationId,
  });
  if (error) throw new Error("AI accounts could not be listed.");
  return (data ?? []) as AiAccountRow[];
}

export type ConnectPlan =
  | { kind: "reuse"; accountId: string }
  | { kind: "create"; displayName: string; purpose: string }
  | { kind: "full" };

/**
 * Decides what Connect means for this provider right now.
 *
 * An explicitly named account is always a reuse — that is the reconnect
 * button. Otherwise: prefer an existing account that is not connected
 * (pending, needs_reauth, disconnected — reconnecting it is what the person
 * wants), then a free purpose slot for a new account, and only when all
 * three slots hold connected accounts is the answer "full".
 */
export function planConnect(
  providerId: BrokerProviderId,
  accounts: readonly AiAccountRow[],
  requestedAccountId?: string,
): ConnectPlan {
  if (requestedAccountId) return { kind: "reuse", accountId: requestedAccountId };

  const providerAccounts = accounts.filter((account) => account.provider === providerId);
  const reusable = providerAccounts.find(
    (account) => account.status === "pending"
      || account.status === "needs_reauth"
      || account.status === "disconnected",
  );
  if (reusable) return { kind: "reuse", accountId: reusable.account_id };

  const purposes = BROKER_PROVIDERS[providerId].purposes;
  const taken = new Set(providerAccounts.map((account) => account.credential_purpose));
  const freeIndex = purposes.findIndex((purpose) => !taken.has(purpose));
  if (freeIndex === -1) return { kind: "full" };

  return {
    kind: "create",
    displayName: accountDisplayName(providerId, freeIndex),
    purpose: purposes[freeIndex],
  };
}
