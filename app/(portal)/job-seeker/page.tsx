import { redirect } from "next/navigation";

import { JobSeekerConsole } from "@/components/job-seeker/console";
import { readViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOrganizationMemberships } from "@/lib/supabase/tenant";

export const metadata = {
  title: "Job Seeker",
};

/**
 * The authenticated job-search command center.
 *
 * This page is hard-gated on the server: a signed-out visitor is redirected
 * to sign-in before anything renders, unlike the console pages that show a
 * signed-out state client-side. The requirement is "only accessible to
 * logged-in users", and a redirect is that requirement, not a rendering of
 * it. Authorization for the data itself is still enforced in the DAL — every
 * row is RLS-scoped to organization membership AND row ownership, so even a
 * member of the same organization cannot read another person's career data.
 */
export default async function JobSeekerPage() {
  const viewer = await readViewer();
  if (!viewer.signedIn) {
    redirect("/sign-in?next=/job-seeker");
  }

  /*
   * A signed-in person with no organization cannot load any job-seeker data —
   * every row is scoped to an organization — so the first visit after sign-up
   * would only ever show a load failure. Route them through workspace
   * onboarding and bring them straight back instead. The lookup failing must
   * not take the page down: the console renders its own error state, and the
   * client-side 409 handling covers the same gap.
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

  return <JobSeekerConsole />;
}
