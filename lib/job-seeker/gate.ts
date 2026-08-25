import { redirect } from "next/navigation";

import { readViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOrganizationMemberships } from "@/lib/supabase/tenant";

/**
 * The gate every job-seeker destination passes through.
 *
 * It began in `app/(portal)/job-seeker/layout.tsx`, which was right while
 * every destination sat under that one segment. `/Job-Search` does not, and a
 * second copy of a gate is the thing that layout's own comment warns about:
 * "a gate repeated in a dozen files is a gate that will eventually be
 * forgotten in one of them". So the rule moved here and both callers run this,
 * rather than each keeping its own version to drift.
 *
 * A signed-out visitor is redirected before anything renders — the
 * requirement is "only accessible to logged-in users", and a redirect is that
 * requirement rather than a rendering of it. Authorization for the data
 * itself is still enforced in the database: every row is RLS-scoped to
 * organization membership *and* row ownership, so even a colleague in the
 * same organization cannot read another person's career data.
 *
 * @param next Where to return after signing in or onboarding. Each entry
 *   point passes its own path, so a person lands back where they were headed
 *   instead of at a section home they did not ask for.
 */
export async function requireJobSeekerViewer(next: string): Promise<void> {
  const viewer = await readViewer();
  if (!viewer.signedIn) {
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }

  /*
   * A signed-in person with no organization cannot load any job-seeker data —
   * every row is scoped to one — so the first visit after sign-up would only
   * ever show a load failure. Route them through workspace onboarding and
   * bring them straight back. The lookup failing must not take the section
   * down: the consoles render their own error states.
   */
  let needsOnboarding = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const memberships = await listOrganizationMemberships(supabase, data.user.id);
      needsOnboarding = memberships.length === 0;
    }
  } catch {
    needsOnboarding = false;
  }
  if (needsOnboarding) {
    redirect(`/auth/onboarding?next=${encodeURIComponent(next)}`);
  }
}
