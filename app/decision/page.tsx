import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { chooseJobSeeker, chooseSoftwareFactory } from "@/app/decision/actions";
import { DecisionOverview } from "@/components/decision-overview";
import { DecisionProductCards } from "@/components/decision-products";
import { GettingStarted } from "@/components/getting-started";
import { RecentActivityCard } from "@/components/recent-activity-card";
import { PageHeader } from "@/components/ui";
import { isDecisionGateOpen } from "@/lib/auth/decision-gate";
import { readViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOrganizationMemberships } from "@/lib/supabase/tenant";

/**
 * Where every sign-in lands: one screen, two products, one decision.
 *
 * Three gates run before anything renders, in the order that makes each one
 * meaningful:
 *
 *   1. Signed out → sign in. The page is for people with a session, and a
 *      redirect is that requirement rather than a rendering of it.
 *   2. No workspace → onboarding, and straight back here. Every number on
 *      this page is scoped to an organization, so without one there is
 *      nothing truthful to show.
 *   3. Gate closed → the console. This is what "only accessible on initial
 *      login" means in practice: the marker is set when a session is
 *      established and cleared the moment a product is chosen.
 *
 * Nothing on the page is illustrative. The overview counts the viewer's own
 * records, the checklist reads the same live sources the console reads, and
 * the activity list is their own audit trail.
 */

async function hasWorkspace(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return false;
    return (await listOrganizationMemberships(supabase, data.user.id)).length > 0;
  } catch {
    // A lookup failure must not strand someone in an onboarding loop for a
    // workspace they already have. Render the page; every card states its own
    // unavailability.
    return true;
  }
}

export default async function DecisionPage() {
  const viewer = await readViewer();
  if (!viewer.signedIn) redirect("/auth/sign-in?next=/decision");

  if (!(await hasWorkspace())) redirect("/auth/onboarding?next=/decision");

  if (!(await isDecisionGateOpen())) redirect("/solutions");

  const greeting = viewer.displayName ?? viewer.email ?? null;

  return (
    <>
      <PageHeader
        title={greeting ? `Welcome back, ${greeting}` : "Welcome back"}
        description="Two products, one account. Pick where to start — the top navigation moves you between them afterwards."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <DecisionProductCards
            onChooseSoftwareFactory={chooseSoftwareFactory}
            onChooseJobSeeker={chooseJobSeeker}
          />
          <GettingStarted authenticated />
        </div>

        <div className="space-y-6">
          <DecisionOverview authenticated />
          <RecentActivityCard authenticated />
        </div>
      </div>

      <p className="mt-8 flex items-start gap-2.5 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        This screen appears once, right after you sign in. Whichever you choose, nothing runs on its
        own: the factory records what you ask for and shows you what is in your repository.
      </p>
    </>
  );
}
