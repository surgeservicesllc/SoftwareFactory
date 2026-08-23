import "server-only";

import { cookies } from "next/headers";

/**
 * The one-time gate in front of `/decision`.
 *
 * The owner's requirement has two halves: every signed-in person lands on the
 * decision page, and that page "is only accessible on initial login". The
 * first half is a default destination. The second half is this module.
 *
 * A marker cookie is *opened* by the act of signing in — the two places a
 * session is actually established, the password route and the email/OAuth
 * callback — and *closed* the moment the person picks a product. So the page
 * is reachable in the window between arriving and choosing, and not after.
 *
 * Properties worth stating, because a gate that is described loosely is a
 * gate nobody can reason about:
 *
 *   * It grants nothing. The cookie decides whether one chooser screen is
 *     shown; `/decision` still resolves the viewer through `readViewer()` and
 *     redirects a signed-out visitor to sign in. Forging this cookie gets an
 *     anonymous visitor a redirect, not a page.
 *   * It is HTTP-only, host-only, `SameSite=Lax` and secure in production, so
 *     browser code cannot read or write it.
 *   * It expires on its own. Someone who signs in and then wanders off
 *     without choosing keeps the chooser for `GATE_MAX_AGE_SECONDS` and no
 *     longer; there is no way to re-open it except by signing in again.
 *
 * The honest limit: a person who lands on the page and navigates away without
 * choosing can return to it until that expiry. Closing it on *any* other
 * navigation would need middleware on every route, which is a much larger
 * mechanism than a chooser screen warrants.
 */

const GATE_COOKIE = "sf-decision";
const GATE_VALUE = "open";

/** Long enough to survive workspace onboarding, short enough to be a login moment. */
export const GATE_MAX_AGE_SECONDS = 15 * 60;

/** Where a freshly signed-in person lands, unless they asked for somewhere specific. */
export const DECISION_PATH = "/decision";

export async function openDecisionGate(): Promise<void> {
  (await cookies()).set(GATE_COOKIE, GATE_VALUE, {
    httpOnly: true,
    maxAge: GATE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function closeDecisionGate(): Promise<void> {
  (await cookies()).delete(GATE_COOKIE);
}

export async function isDecisionGateOpen(): Promise<boolean> {
  return (await cookies()).get(GATE_COOKIE)?.value === GATE_VALUE;
}
