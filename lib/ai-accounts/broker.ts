import "server-only";

import {
  maxAiAccountsPerProvider,
  purposeForSlot,
  type BrokerProviderId,
} from "@/lib/ai-accounts/purposes";
import { findBotProvider } from "@/lib/bots/catalog";

/**
 * The account side of the auth broker: how a Connect click chooses between
 * reusing an account and creating one, and the account listing the routes
 * share. The purpose vocabulary itself lives in `lib/ai-accounts/purposes.ts`
 * so the worker — plain Node, no `server-only` — can share it.
 */

export {
  BROKER_PROVIDERS,
  isBrokerProviderId,
  relayCodePurpose,
  type BrokerProviderId,
} from "@/lib/ai-accounts/purposes";

/** "Claude account 2" — the slot is visible in the name on purpose. */
export function accountDisplayName(providerId: BrokerProviderId, slotIndex: number): string {
  const label = findBotProvider(providerId)?.label ?? providerId;
  return `${label} account ${slotIndex + 1}`;
}

export type AiAccountRow = {
  account_id: string;
  provider: string;
  auth_method: string;
  display_name: string;
  /** Which provider account signed in — display data, absent until known. */
  provider_identity?: string | null;
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
 * wants), then the lowest free slot for a new account. Slots are unbounded;
 * "full" happens only at the configured capacity ceiling, never at a
 * hard-coded count.
 */
export function planConnect(
  providerId: BrokerProviderId,
  accounts: readonly AiAccountRow[],
  requestedAccountId?: string,
  capacity: number = maxAiAccountsPerProvider(),
): ConnectPlan {
  if (requestedAccountId) return { kind: "reuse", accountId: requestedAccountId };

  const providerAccounts = accounts.filter((account) => account.provider === providerId);
  const reusable = providerAccounts.find(
    (account) => account.status === "pending"
      || account.status === "needs_reauth"
      || account.status === "disconnected",
  );
  if (reusable) return { kind: "reuse", accountId: reusable.account_id };

  if (providerAccounts.length >= capacity) return { kind: "full" };

  const taken = new Set(providerAccounts.map((account) => account.credential_purpose));
  let freeIndex = 0;
  while (taken.has(purposeForSlot(providerId, freeIndex))) freeIndex += 1;

  return {
    kind: "create",
    displayName: accountDisplayName(providerId, freeIndex),
    purpose: purposeForSlot(providerId, freeIndex),
  };
}
