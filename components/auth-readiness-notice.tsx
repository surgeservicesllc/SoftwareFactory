import { KeyRound } from "lucide-react";

import { Notice } from "@/components/ui";
import { readAuthReadiness } from "@/lib/supabase/auth-readiness";

/**
 * Reports whether visitors can currently create an account.
 *
 * A server component on purpose: the check reads Supabase's public settings
 * endpoint, and this belongs next to the other connection truth rather than in
 * a browser request. When sign-up is healthy it renders nothing, so the panel
 * only ever appears because something needs a decision.
 */
export async function AuthReadinessNotice() {
  const readiness = await readAuthReadiness();
  if (readiness.state === "ready" || readiness.findings.length === 0) return null;

  return (
    <Notice tone={readiness.state === "blocked" ? "danger" : "warning"} icon={KeyRound}>
      <p className="font-semibold text-foreground">
        {readiness.state === "blocked"
          ? "Account creation is switched off"
          : "Account creation is rate limited"}
      </p>
      {readiness.findings.map((finding) => (
        <p key={finding} className="mt-1">{finding}</p>
      ))}
    </Notice>
  );
}
