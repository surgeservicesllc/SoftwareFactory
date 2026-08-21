import { OnboardingForm } from "@/app/auth/onboarding/onboarding-form";
import { normalizeReturnPath } from "@/lib/supabase/request";

export const metadata = { title: "Name your workspace" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  // Pages that require a workspace (like /job-seeker) send people here with
  // a `next` so finishing setup returns them to what they were doing rather
  // than dropping everyone into the projects console.
  const returnTo = typeof query.next === "string"
    ? normalizeReturnPath(query.next, "/solutions/projects")
    : "/solutions/projects";

  return <OnboardingForm returnTo={returnTo} />;
}
