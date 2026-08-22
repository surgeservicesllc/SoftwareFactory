import { redirect } from "next/navigation";

import { readViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOrganizationMemberships } from "@/lib/supabase/tenant";

/**
 * The gate for every Job Seeker destination.
 *
 * It used to live in `page.tsx`, which was correct while Job Seeker was one
 * page. It is now a section, and a gate repeated in a dozen files is a gate
 * that will eventually be forgotten in one of them. Here it applies to the
 * whole subtree by construction.
 *
 * A signed-out visitor is redirected before anything renders — the
 * requirement is "only accessible to logged-in users", and a redirect is that
 * requirement rather than a rendering of it. Authorization for the data
 * itself is still enforced in the database: every row is RLS-scoped to
 * organization membership *and* row ownership, so even a colleague in the
 * same organization cannot read another person's career data.
 */
export default async function JobSeekerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await readViewer();
  if (!viewer.signedIn) {
    redirect("/sign-in?next=/job-seeker");
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
    redirect("/auth/onboarding?next=/job-seeker");
  }

  return <>{children}</>;
}
