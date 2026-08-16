/**
 * The broker's purpose vocabulary, shared between the Next.js server and the
 * auth-broker worker (plain Node, where `server-only` throws by design).
 * Nothing here is secret — these are names, not credentials.
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

/**
 * The seal context for a session's relayed confirmation code. Bound to the
 * session rather than the account so a code parked for one sign-in can never
 * be opened against another, even on the same account.
 */
export function relayCodePurpose(sessionId: string): string {
  return `ai_auth_relay:${sessionId}`;
}
