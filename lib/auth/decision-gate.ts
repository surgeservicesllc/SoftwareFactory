import "server-only";

import { cookies } from "next/headers";

/**
 * The one-time gate in front of `/decision`.
 *
 * The owner's requirement has two halves: every signed-in person lands on the
 * decision page, and that page "is only accessible on initial login". The
 * first half is a default destination. The second half is this module.
 *
 * The marker records the **decision**, not the permission.
 *
 * That distinction is the whole design, and getting it backwards is what broke
 * the page on the day it shipped. The first version wrote a cookie meaning
 * "this person may see the chooser", set only by a fresh sign-in. Every
 * session that already existed carried no such cookie, so for every person
 * already signed in — the owner included — `/decision` redirected to
 * `/solutions` and the feature was unreachable until they signed out and back
 * in. A default of "closed" makes the absence of information mean *denied*,
 * and the absence of information here is the completely ordinary case.
 *
 * So the cookie is written when a product is picked, and cleared whenever a
 * session begins or ends:
 *
 *   * absent  → this person has not chosen since they last signed in, so the
 *               chooser is shown. A session that predates the feature, a
 *               cleared cookie jar, and a brand-new login all land here, and
 *               all three should see the page.
 *   * chosen  → they picked a product; `/decision` sends them to the console.
 *
 * Properties worth stating, because a gate that is described loosely is a
 * gate nobody can reason about:
 *
 *   * It grants nothing. The cookie decides whether one chooser screen is
 *     shown; `/decision` still resolves the viewer through `readViewer()` and
 *     redirects a signed-out visitor to sign in. Forging this cookie in
 *     either direction gets an anonymous visitor a redirect, not a page — and
 *     the most a signed-in person can do by forging it is see or skip a
 *     screen they were already entitled to.
 *   * It is HTTP-only, host-only, `SameSite=Lax` and secure in production, so
 *     browser code cannot read or write it.
 *   * Signing in clears it, so the chooser comes back on the next login,
 *     which is what "land all users on it" requires. Signing out clears it
 *     too, so a shared browser never inherits the previous person's choice.
 *
 * The honest limit: within one session, someone who chooses and then clears
 * their cookies sees the chooser again. That is a screen, not a permission.
 */

const GATE_COOKIE = "sf-decision";
const CHOSEN = "chosen";

/** Long enough to outlive a session; the value is cleared at both ends of one anyway. */
const CHOSEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Where a freshly signed-in person lands, unless they asked for somewhere specific. */
export const DECISION_PATH = "/decision";

/**
 * A session has begun: whatever was chosen last time no longer applies.
 *
 * Called from the two places a session actually comes into existence — the
 * password route and the email/OAuth callback.
 */
export async function openDecisionGate(): Promise<void> {
  (await cookies()).delete(GATE_COOKIE);
}

/** A product was picked. The chooser is done until the next sign-in. */
export async function closeDecisionGate(): Promise<void> {
  (await cookies()).set(GATE_COOKIE, CHOSEN, {
    httpOnly: true,
    maxAge: CHOSEN_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

/** The session ended: the next person on this browser starts from nothing. */
export async function forgetDecision(): Promise<void> {
  (await cookies()).delete(GATE_COOKIE);
}

export async function isDecisionGateOpen(): Promise<boolean> {
  return (await cookies()).get(GATE_COOKIE)?.value !== CHOSEN;
}
