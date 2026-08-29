import { redirect } from "next/navigation";

import { readViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOrganizationMemberships } from "@/lib/supabase/tenant";

/**
 * The gate every person-scoped portal destination passes through.
 *
 * It began in `app/(portal)/job-seeker/layout.tsx`, moved to
 * `lib/job-seeker/gate.ts` when `/Job-Search` needed it too, and moved here
 * when the Budget Tracker became the second product to want the same rule.
 * The reasoning has not changed at any step and is worth keeping in front of
 * whoever adds the third: a gate repeated in a dozen files is a gate that will
 * eventually be forgotten in one of them, and the one it is forgotten in will
 * be the one showing somebody's bank balance.
 *
 * A signed-out visitor is redirected before anything renders. Authorization
 * for the data itself is still enforced in the database — every row on these
 * surfaces is RLS-scoped to organization membership *and* row ownership, so
 * even a colleague in the same organization cannot read another person's
 * career history or finances. This gate decides who sees a page; the database
 * decides who sees a row, and it is the one that must not be trusted to the
 * application.
 *
 * @param next Where to return after signing in or onboarding. Each entry
 *   point passes its own path, so a person lands back where they were headed
 *   instead of at a section home they did not ask for.
 */
export async function requirePortalViewer(next: string): Promise<void> {
  const viewer = await readViewer();
  if (!viewer.signedIn) {
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }

  /*
   * A signed-in person with no organization cannot load any of this data —
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
