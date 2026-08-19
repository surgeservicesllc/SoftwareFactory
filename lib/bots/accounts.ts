/**
 * Which AI accounts can still back a bot.
 *
 * The console had been treating "connected" as the answer, and that is
 * stricter than the system it is a console for. A bot's readiness is resolved
 * from whether its credential *resolves on the server* — `evaluateBotReadiness`
 * asks for credential presence and nothing else — and
 * `mark_ai_account_needs_reauth` sets only `status` and `last_error`. An
 * account whose last verification came back 403 therefore still holds its
 * credential, and a bot referencing that slot is `ready` by the definition the
 * assign endpoint itself applies.
 *
 * The consequence of getting this wrong was not cosmetic: with every account
 * in `needs_reauth`, the console offered no way to create a bot, no way to
 * assign one, and no explanation — the journey simply stopped, on a rule the
 * server would not have enforced.
 *
 * Disconnecting and revoking do remove the credential material, and an account
 * that has never been signed into never had any. Those three cannot back a bot,
 * and saying so is a fact rather than a caution.
 */

export type AiAccountStatus =
  | "pending"
  | "connected"
  | "needs_reauth"
  | "disconnected"
  | "revoked"
  | (string & {});

/** True when the account still has credential material a bot can reference. */
export function accountCanBackABot(status: AiAccountStatus): boolean {
  return status === "connected" || status === "needs_reauth";
}

/**
 * True when a bot made from this account will not run until someone signs in
 * again. It can still be created and assigned; the work simply waits.
 */
export function accountNeedsSignInAgain(status: AiAccountStatus): boolean {
  return status === "needs_reauth";
}

/** Why an account cannot back a bot, in the words the console shows. */
export function whyAccountCannotBackABot(status: AiAccountStatus): string | null {
  if (accountCanBackABot(status)) return null;
  if (status === "pending") return "not signed in yet";
  if (status === "disconnected") return "its credential was removed";
  if (status === "revoked") return "its credential was revoked";
  return "its credential is unavailable";
}
