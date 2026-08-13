"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Ends the session.
 *
 * Sign-out is a POST to a same-origin route rather than a link, so a prefetch,
 * a crawler, or an image tag on another site cannot sign someone out.
 * `router.refresh()` is what makes the rest of the site change back: every
 * layout re-reads the viewer on the server, so the navigation returns to its
 * signed-out shape without a full page load.
 */
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
    } catch {
      // Fall through: refreshing re-reads the session either way, so a failed
      // request shows the still-signed-in state rather than a false sign-out.
    } finally {
      setPending(false);
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <button type="button" onClick={() => void signOut()} disabled={pending} className={className}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
