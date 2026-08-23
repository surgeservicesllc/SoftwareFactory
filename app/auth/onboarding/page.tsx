import { OnboardingForm } from "@/app/auth/onboarding/onboarding-form";
import { DECISION_PATH } from "@/lib/auth/decision-gate";
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
  // Without a `next`, a brand-new workspace hands off to the same chooser
  // every other sign-in lands on, rather than skipping it by being new.
  const returnTo = typeof query.next === "string"
    ? normalizeReturnPath(query.next, DECISION_PATH)
    : DECISION_PATH;

  return <OnboardingForm returnTo={returnTo} />;
}
