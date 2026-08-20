import { redirect } from "next/navigation";

import { JobSeekerConsole } from "@/components/job-seeker/console";
import { readViewer } from "@/lib/auth/viewer";

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

  return <JobSeekerConsole />;
}
