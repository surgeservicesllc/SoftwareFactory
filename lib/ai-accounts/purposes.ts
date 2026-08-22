/**
 * The broker's purpose vocabulary, shared between the Next.js server and the
 * auth-broker worker (plain Node, where `server-only` throws by design).
 * Nothing here is secret — these are names, not credentials.
 *
 * Slots are unbounded by design: `claude` is slot 1, `claude_2` slot 2, and
 * `claude_47` is as valid as either. The vault's purpose pattern
 * (`^[a-z][a-z0-9_]{1,62}$`) admits them all without schema change, and the
 * seal binds each credential to its own purpose, so accounts never collide.
 * The only ceiling is configured platform capacity, never a hard-coded
 * maximum — that is a stated product requirement.
 *
 * The base purposes are deliberately the ones the connect-command flow uses.
 * A credential the broker seals under `claude_2` is immediately visible to
 * the existing readiness bridge and worker overlay — the two paths converge
 * on one vault row rather than growing parallel credential stores.
 */

export const BROKER_PROVIDERS = {
  anthropic: { basePurpose: "claude" },
  openai: { basePurpose: "codex" },
} as const;

export type BrokerProviderId = keyof typeof BROKER_PROVIDERS;

export function isBrokerProviderId(value: string): value is BrokerProviderId {
  return Object.hasOwn(BROKER_PROVIDERS, value);
}

/**
 * Slot numbers stay below this in any purpose or variable name. It exists so
 * a parsed suffix cannot blow past the vault's 63-character purpose pattern —
 * it is a syntactic bound on a name, not a product cap on accounts, which is
 * `maxAiAccountsPerProvider()` below and configurable.
 */
const SLOT_NUMBER_CEILING = 10_000;

/** Slot 0 is the bare purpose; slot n is `base_{n+1}`, without limit. */
export function purposeForSlot(providerId: BrokerProviderId, slotIndex: number): string {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOT_NUMBER_CEILING) {
    throw new Error("The account slot index is out of range.");
  }
  const base = BROKER_PROVIDERS[providerId].basePurpose;
  return slotIndex === 0 ? base : `${base}_${slotIndex + 1}`;
}

/** The inverse: which slot a purpose occupies, or null if it is not one. */
export function slotIndexForPurpose(
  providerId: BrokerProviderId,
  purpose: string,
): number | null {
  const base = BROKER_PROVIDERS[providerId].basePurpose;
  if (purpose === base) return 0;
  const match = new RegExp(`^${base}_([2-9]|[1-9][0-9]{1,3})$`).exec(purpose);
  if (!match) return null;
  return Number(match[1]) - 1;
}

/** Any provider's slot purpose — `claude`, `codex_2`, `claude_47`, … */
export function isSlotPurpose(purpose: string): boolean {
  return (Object.keys(BROKER_PROVIDERS) as BrokerProviderId[]).some(
    (providerId) => slotIndexForPurpose(providerId, purpose) !== null,
  );
}

/**
 * The configured capacity ceiling for accounts per provider. A platform
 * setting, not a product limit: the default is generous, and an operator
 * raises it by configuration rather than by code change.
 */
export function maxAiAccountsPerProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = Number(env.SOFTWAREFACTORY_MAX_AI_ACCOUNTS_PER_PROVIDER ?? "");
  if (Number.isInteger(raw) && raw >= 1 && raw < SLOT_NUMBER_CEILING) return raw;
  return 100;
}

/**
 * The seal context for a session's relayed confirmation code. Bound to the
 * session rather than the account so a code parked for one sign-in can never
 * be opened against another, even on the same account.
 */
export function relayCodePurpose(sessionId: string): string {
  return `ai_auth_relay:${sessionId}`;
}
